import type { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { trustedClock } from "../../config/trusted-clock";
import { datePartsInZone } from "../../config/tz";
import {
  addCalendarDays,
  calendarDayDiff,
  classifyRetention,
  formatDateOnly,
  retentionMatureCutoff,
  type RenewalEvidence,
  type RetentionState,
} from "../../domain/retention/retention-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import {
  filterRetentionItems,
  retentionBreakdowns,
  retentionCohorts,
  retentionDimensions,
} from "../../domain/retention/retention-analytics";
import {
  resolveRetentionSettings,
  RETENTION_GRACE_KEY,
  RETENTION_HORIZON_KEY,
} from "../../domain/retention/retention-settings";

const DEFAULT_HISTORY_DAYS = 30;

const membershipSelect = {
  membresia_id: true,
  ci: true,
  id_planes_pago: true,
  id_entrenador: true,
  plan_nombre_snapshot: true,
  precio_snapshot: true,
  moneda_id: true,
  fecha_inicio: true,
  fecha_fin: true,
  estado: true,
  activada_at: true,
  reconstruida: true,
  confianza_reconstruccion: true,
  created_at: true,
} satisfies Prisma.MembresiaClienteSelect;

type MembershipRow = Prisma.MembresiaClienteGetPayload<{
  select: typeof membershipSelect;
}>;

export class RetentionQueryError extends Error {
  public readonly status = 400 as const;

  constructor(message: string) {
    super(message);
  }
}

export interface RetentionQuery {
  from?: string;
  to?: string;
  states?: string[];
  planIds?: string[];
  trainerIds?: string[];
}

function businessCalendarDate(timeZone: string, instant: Date): Date {
  const parts = datePartsInZone(timeZone, instant);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

// El contrato actual guarda fechas de calendario a 00:00Z. Datos heredados
// anteriores al contrato pueden conservar medianoche local u otra hora; solo
// esos registros se interpretan en la zona del gimnasio, sin reescribirlos.
function storedCalendarDate(timeZone: string, value: Date): Date {
  if (
    value.getUTCHours() === 0
    && value.getUTCMinutes() === 0
    && value.getUTCSeconds() === 0
    && value.getUTCMilliseconds() === 0
  ) {
    return value;
  }
  return businessCalendarDate(timeZone, value);
}

function parseDateOnly(value: string | undefined, name: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new RetentionQueryError(`${name} debe usar YYYY-MM-DD.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (formatDateOnly(date) !== value.trim()) {
    throw new RetentionQueryError(`${name} no es una fecha de calendario válida.`);
  }
  return date;
}

function firstByClient<T extends { ci: string }>(rows: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) if (!result.has(row.ci)) result.set(row.ci, row);
  return result;
}

function percent(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 100;
}

function priority(state: RetentionState): number {
  return {
    VENCE_HOY: 0,
    EN_GRACIA: 1,
    SALIDA: 2,
    PROXIMO: 3,
    RECUPERADO: 4,
    RENOVADO_EN_GRACIA: 5,
    RENOVADO_PUNTUAL: 6,
  }[state];
}

export class RetentionService {
  async getDashboard(gymId: string, query: RetentionQuery = {}) {
    const nowUtc = trustedClock.nowUtc();
    const [gym, configurations] = await Promise.all([
      prisma.gym.findUnique({
        where: { gym_id: gymId },
        select: { timezone: true },
      }),
      prisma.configuracionSistema.findMany({
        where: {
          clave: { in: [RETENTION_GRACE_KEY, RETENTION_HORIZON_KEY] },
          gym_id: { in: [gymId, "GLOBAL"] },
          is_deleted: false,
        },
        select: { clave: true, valor: true, gym_id: true },
      }),
    ]);
    const timeZone = gym?.timezone?.trim() || env.defaultGymTimezone;
    const businessToday = businessCalendarDate(timeZone, nowUtc);
    const { grace, horizon } = resolveRetentionSettings(configurations, gymId);
    const from = parseDateOnly(query.from, "desde")
      ?? addCalendarDays(businessToday, -DEFAULT_HISTORY_DAYS);
    const to = parseDateOnly(query.to, "hasta")
      ?? addCalendarDays(businessToday, horizon.value);
    if (from > to) throw new RetentionQueryError("desde no puede ser posterior a hasta.");
    if (calendarDayDiff(from, to) > 730) {
      throw new RetentionQueryError("El período máximo de consulta es de 730 días.");
    }

    const candidates = await prisma.membresiaCliente.findMany({
      where: {
        gym_id: gymId,
        is_deleted: false,
        estado: { in: ["ACTIVA", "VENCIDA"] },
        fecha_fin: { gte: from, lt: addCalendarDays(to, 1) },
      },
      select: membershipSelect,
      orderBy: [{ fecha_fin: "asc" }, { created_at: "asc" }],
      take: 2000,
    });
    const clientIds = [...new Set(candidates.map((item) => item.ci))];
    if (clientIds.length === 0) {
      return this.emptyResult({
        gymId,
        nowUtc,
        timeZone,
        businessToday,
        from,
        to,
        grace,
        horizon,
        query,
      });
    }

    const [memberships, clients, assignments, payments, attendances, managements] = await Promise.all([
      prisma.membresiaCliente.findMany({
        where: {
          gym_id: gymId,
          ci: { in: clientIds },
          is_deleted: false,
          estado: { in: ["ACTIVA", "VENCIDA", "PAUSADA"] },
        },
        select: membershipSelect,
        orderBy: [{ fecha_inicio: "asc" }, { created_at: "asc" }],
      }),
      prisma.cliente.findMany({
        where: { ci: { in: clientIds }, gym_id: gymId, is_deleted: false },
        select: { ci: true, nombres: true, apellidos: true, telefono: true, correo: true },
      }),
      prisma.membresiaEntrenadorAsignacion.findMany({
        where: {
          gym_id: gymId,
          membresia_id: { in: candidates.map((item) => item.membresia_id) },
          is_deleted: false,
          estado: { in: ["ACTIVA", "CERRADA"] },
        },
        orderBy: { fecha_inicio: "desc" },
      }),
      prisma.pagoCliente.findMany({
        where: { ci: { in: clientIds }, gym_id: gymId, is_deleted: false },
        select: { ci: true, fecha: true },
        orderBy: { fecha: "desc" },
      }),
      prisma.asistencia.findMany({
        where: { ci: { in: clientIds }, gym_id: gymId, is_deleted: false },
        select: { ci: true, created_at: true },
        orderBy: { created_at: "desc" },
      }),
      prisma.retencionGestion.findMany({
        where: {
          gym_id: gymId,
          membresia_id: { in: candidates.map((item) => item.membresia_id) },
          is_deleted: false,
        },
        orderBy: [{ registrada_at: "desc" }, { gestion_id: "desc" }],
      }),
    ]);

    const clientMap = new Map(clients.map((item) => [item.ci, item]));
    const paymentMap = firstByClient(payments);
    const attendanceMap = firstByClient(attendances);
    const latestManagementByMembership = new Map<string, typeof managements[number]>();
    const managementCountByMembership = new Map<string, number>();
    for (const management of managements) {
      managementCountByMembership.set(
        management.membresia_id,
        (managementCountByMembership.get(management.membresia_id) ?? 0) + 1,
      );
      if (!latestManagementByMembership.has(management.membresia_id)) {
        latestManagementByMembership.set(management.membresia_id, management);
      }
    }
    const membershipsByClient = new Map<string, MembershipRow[]>();
    for (const membership of memberships) {
      const rows = membershipsByClient.get(membership.ci) ?? [];
      rows.push(membership);
      membershipsByClient.set(membership.ci, rows);
    }

    const trainerIds = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.id_entrenador) trainerIds.add(candidate.id_entrenador);
    }
    for (const assignment of assignments) trainerIds.add(assignment.id_entrenador);
    const trainers = trainerIds.size === 0
      ? []
      : await prisma.entrenador.findMany({
          where: { id_entrenador: { in: [...trainerIds] }, gym_id: gymId, is_deleted: false },
          select: { id_entrenador: true, nombres_entrenador: true, apellidos_entrenador: true },
        });
    const trainerMap = new Map(trainers.map((item) => [item.id_entrenador, item]));
    let missingActivationEvidence = 0;

    const allItems = candidates.flatMap((candidate) => {
      const dueDate = storedCalendarDate(timeZone, candidate.fecha_fin);
      const laterMemberships = (membershipsByClient.get(candidate.ci) ?? []).filter((item) =>
        item.membresia_id !== candidate.membresia_id
        && storedCalendarDate(timeZone, item.fecha_inicio) >= dueDate
        && item.estado !== "PAUSADA"
      );
      let renewal: MembershipRow | null = null;
      let renewalEffectiveDate: Date | null = null;
      let renewalEvidence: RenewalEvidence | null = null;
      for (const possible of laterMemberships) {
        if (possible.activada_at) {
          renewal = possible;
          renewalEffectiveDate = businessCalendarDate(timeZone, possible.activada_at);
          renewalEvidence = "ACTIVADA_AT";
          break;
        }
        if (possible.reconstruida) {
          renewal = possible;
          renewalEffectiveDate = storedCalendarDate(timeZone, possible.fecha_inicio);
          renewalEvidence = "FECHA_INICIO_RECONSTRUIDA";
          break;
        }
        missingActivationEvidence += 1;
      }

      const classification = classifyRetention({
        membershipState: candidate.estado,
        dueDate,
        businessToday,
        graceDays: grace.value,
        horizonDays: horizon.value,
        renewalEffectiveDate,
        renewalEvidence,
      });
      if (!classification) return [];

      const assignment = assignments.find((item) =>
        item.membresia_id === candidate.membresia_id
        && item.fecha_inicio <= candidate.fecha_fin
        && (!item.fecha_fin || item.fecha_fin > candidate.fecha_fin)
      );
      const trainerId = assignment?.id_entrenador ?? candidate.id_entrenador;
      const trainer = trainerId ? trainerMap.get(trainerId) : null;
      const client = clientMap.get(candidate.ci);
      const latestManagement = latestManagementByMembership.get(candidate.membresia_id);

      return [{
        membership_id: candidate.membresia_id,
        ci: candidate.ci,
        client_name: client
          ? `${client.nombres} ${client.apellidos}`.trim()
          : candidate.ci,
        phone: client?.telefono?.toString() ?? null,
        email: client?.correo ?? null,
        plan: {
          id: candidate.id_planes_pago,
          name: candidate.plan_nombre_snapshot,
          price: Number(candidate.precio_snapshot),
          currency_id: candidate.moneda_id,
        },
        trainer: trainerId
          ? {
              id: trainerId,
              name: trainer
                ? `${trainer.nombres_entrenador} ${trainer.apellidos_entrenador}`.trim()
                : "Entrenador no disponible",
              evidence: assignment ? "ASIGNACION_EN_FECHA" : "SNAPSHOT_MEMBRESIA",
            }
          : null,
        expected_renewal_date: formatDateOnly(classification.dueDate),
        grace_end_date: formatDateOnly(classification.graceEndDate),
        exit_date: formatDateOnly(classification.exitDate),
        state: classification.state,
        reason: classification.reason,
        days_from_due: classification.daysFromDue,
        historical_exit: classification.historicalExit,
        renewal: renewal && renewalEffectiveDate
          ? {
              membership_id: renewal.membresia_id,
              effective_date: formatDateOnly(renewalEffectiveDate),
              delay_days: classification.renewalDelayDays,
              evidence: renewalEvidence,
            }
          : null,
        last_payment_at_utc: paymentMap.get(candidate.ci)?.fecha.toISOString() ?? null,
        last_attendance_at_utc: attendanceMap.get(candidate.ci)?.created_at?.toISOString() ?? null,
        management: {
          status: latestManagement?.resultado ?? "PENDIENTE",
          channel: latestManagement?.canal ?? null,
          note: latestManagement?.nota ?? null,
          promise_date: latestManagement?.promesa_fecha
            ? formatDateOnly(latestManagement.promesa_fecha)
            : null,
          next_management_date: latestManagement?.proxima_gestion_fecha
            ? formatDateOnly(latestManagement.proxima_gestion_fecha)
            : null,
          registered_at_utc: latestManagement?.registrada_at.toISOString() ?? null,
          registered_by: latestManagement?.registrada_por_nombre_snapshot ?? null,
          history_count: managementCountByMembership.get(candidate.membresia_id) ?? 0,
          overdue: Boolean(
            latestManagement?.proxima_gestion_fecha
            && latestManagement.proxima_gestion_fecha <= businessToday,
          ),
        },
        reconstructed: candidate.reconstruida,
        reconstruction_confidence: candidate.confianza_reconstruccion,
      }];
    });

    const dimensions = retentionDimensions(allItems);
    const items = filterRetentionItems(allItems, {
      states: query.states,
      planIds: query.planIds,
      trainerIds: query.trainerIds,
    });
    items.sort((a, b) => priority(a.state) - priority(b.state)
      || a.expected_renewal_date.localeCompare(b.expected_renewal_date)
      || a.client_name.localeCompare(b.client_name));

    const matureCutoff = retentionMatureCutoff(businessToday, grace.value);
    const mature = items.filter((item) => item.expected_renewal_date <= formatDateOnly(matureCutoff));
    const retained = mature.filter((item) =>
      item.state === "RENOVADO_PUNTUAL" || item.state === "RENOVADO_EN_GRACIA"
    ).length;
    const onTime = mature.filter((item) => item.state === "RENOVADO_PUNTUAL").length;
    const historicalExits = mature.filter((item) => item.historical_exit).length;
    const recovered = mature.filter((item) => item.state === "RECUPERADO").length;
    const byState = Object.fromEntries(
      ["PROXIMO", "VENCE_HOY", "EN_GRACIA", "RENOVADO_PUNTUAL", "RENOVADO_EN_GRACIA", "SALIDA", "RECUPERADO"]
        .map((state) => [state, items.filter((item) => item.state === state).length]),
    );
    const cohorts = retentionCohorts(items, formatDateOnly(matureCutoff));
    const breakdowns = retentionBreakdowns(items, formatDateOnly(matureCutoff));

    return {
      generated_at_utc: nowUtc.toISOString(),
      gym_id: gymId,
      timezone: timeZone,
      business_date: formatDateOnly(businessToday),
      window: { from: formatDateOnly(from), to: formatDateOnly(to) },
      applied_filters: {
        states: query.states ?? [],
        plan_ids: query.planIds ?? [],
        trainer_ids: query.trainerIds ?? [],
      },
      dimensions,
      policy: {
        grace_days: grace.value,
        grace_source: grace.source,
        horizon_days: horizon.value,
        horizon_source: horizon.source,
        mature_cohort_cutoff: formatDateOnly(matureCutoff),
        provisional: grace.source === "DEFAULT",
      },
      metrics: {
        total_visible: items.length,
        by_state: byState,
        mature_eligible: mature.length,
        retained,
        retention_rate_pct: percent(retained, mature.length),
        on_time_renewals: onTime,
        on_time_rate_pct: percent(onTime, mature.length),
        historical_exits: historicalExits,
        recovered,
        recovery_rate_pct: percent(recovered, historicalExits),
        management: {
          pending: items.filter((item) => item.management.status === "PENDIENTE").length,
          promised: items.filter((item) => item.management.status === "PROMESA_PAGO").length,
          due_followups: items.filter((item) => item.management.overdue).length,
        },
      },
      quality: {
        missing_activation_evidence: missingActivationEvidence,
        caveats: [
          "La cohorte de retención solo incluye vencimientos cuyo período de gracia ya terminó.",
          "Una recuperación conserva la salida histórica; no reescribe la tasa de retención original.",
          ...(timeZone === "Etc/UTC" ? ["El gimnasio conserva Etc/UTC; configure su zona real antes de usar cortes operativos."] : []),
        ],
      },
      definitions: {
        expected_renewal_date: "fecha_fin exclusiva del contrato anterior",
        retained: "renovó antes de vencer o dentro del período de gracia",
        historical_exit: "no renovó antes del primer día posterior a la gracia",
        recovered: "renovó después de haber causado una salida",
        trainer_attribution: "asignación vigente en la fecha esperada de renovación",
      },
      cohorts,
      breakdowns,
      items,
    };
  }

  private emptyResult(context: {
    gymId: string;
    nowUtc: Date;
    timeZone: string;
    businessToday: Date;
    from: Date;
    to: Date;
    grace: { value: number; source: "GYM" | "GLOBAL" | "DEFAULT" };
    horizon: { value: number; source: "GYM" | "GLOBAL" | "DEFAULT" };
    query: RetentionQuery;
  }) {
    const { gymId, nowUtc, timeZone, businessToday, from, to, grace, horizon, query } = context;
    return {
      generated_at_utc: nowUtc.toISOString(),
      gym_id: gymId,
      timezone: timeZone,
      business_date: formatDateOnly(businessToday),
      window: { from: formatDateOnly(from), to: formatDateOnly(to) },
      applied_filters: {
        states: query.states ?? [],
        plan_ids: query.planIds ?? [],
        trainer_ids: query.trainerIds ?? [],
      },
      dimensions: { plans: [], trainers: [] },
      policy: {
        grace_days: grace.value,
        grace_source: grace.source,
        horizon_days: horizon.value,
        horizon_source: horizon.source,
        mature_cohort_cutoff: formatDateOnly(retentionMatureCutoff(businessToday, grace.value)),
        provisional: grace.source === "DEFAULT",
      },
      metrics: {
        total_visible: 0,
        by_state: Object.fromEntries(
          ["PROXIMO", "VENCE_HOY", "EN_GRACIA", "RENOVADO_PUNTUAL", "RENOVADO_EN_GRACIA", "SALIDA", "RECUPERADO"]
            .map((state) => [state, 0]),
        ),
        mature_eligible: 0,
        retained: 0,
        retention_rate_pct: null,
        on_time_renewals: 0,
        on_time_rate_pct: null,
        historical_exits: 0,
        recovered: 0,
        recovery_rate_pct: null,
        management: { pending: 0, promised: 0, due_followups: 0 },
      },
      quality: {
        missing_activation_evidence: 0,
        caveats: ["No hay vencimientos elegibles dentro del período consultado."],
      },
      definitions: {
        expected_renewal_date: "fecha_fin exclusiva del contrato anterior",
        retained: "renovó antes de vencer o dentro del período de gracia",
        historical_exit: "no renovó antes del primer día posterior a la gracia",
        recovered: "renovó después de haber causado una salida",
        trainer_attribution: "asignación vigente en la fecha esperada de renovación",
      },
      cohorts: [],
      breakdowns: {
        plans: [],
        trainers: [],
        unattributed_trainer_total: 0,
      },
      items: [],
    };
  }
}
