import { CompensationProfileService } from "../../application/accounting/compensation-profile.service";
import type { TrainerServiceCostReader } from "../../application/reporting/trainer-service-cost.reader";
import type {
  TrainerServiceCostApplicationSnapshot,
  TrainerServiceCostPauseSnapshot,
  TrainerServiceCostSnapshot,
} from "../../domain/trainer-service-cost-policy";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";

export class PrismaTrainerServiceCostReader implements TrainerServiceCostReader {
  private readonly profiles = new CompensationProfileService();

  async currentBusinessDate(gymId: string) {
    return prisma.$transaction((tx) =>
      this.profiles.businessDateForInstant(tx, gymId, trustedClock.nowUtc())
    );
  }

  async readCosts(gymId: string): Promise<TrainerServiceCostSnapshot[]> {
    const [installments, fixedObligations, trainers, currencies] = await Promise.all([
      prisma.entrenadorComisionCuota.findMany({
        where: { gym_id: gymId, is_deleted: false },
        orderBy: [{ periodo_inicio: "asc" }, { cuota_id: "asc" }],
      }),
      prisma.entrenadorObligacionFija.findMany({
        where: { gym_id: gymId, is_deleted: false },
        orderBy: [{ periodo_inicio: "asc" }, { obligacion_id: "asc" }],
      }),
      prisma.entrenador.findMany({
        where: { gym_id: gymId, is_deleted: false },
        select: {
          id_entrenador: true,
          nombres_entrenador: true,
          apellidos_entrenador: true,
        },
      }),
      prisma.moneda.findMany({
        where: { is_deleted: false },
        select: { moneda_id: true, codigo: true },
      }),
    ]);
    const accrualIds = [...new Set(installments.map((row) => row.devengo_id))];
    const installmentIds = installments.map((row) => row.cuota_id);
    const fixedIds = fixedObligations.map((row) => row.obligacion_id);
    const [accruals, installmentApplications, fixedApplications] = await Promise.all([
      accrualIds.length
        ? prisma.entrenadorComisionDevengo.findMany({
            where: { gym_id: gymId, devengo_id: { in: accrualIds }, is_deleted: false },
          })
        : Promise.resolve([]),
      installmentIds.length
        ? prisma.entrenadorLiquidacionAplicacion.findMany({
            where: {
              gym_id: gymId,
              cuota_id: { in: installmentIds },
              is_deleted: false,
            },
          })
        : Promise.resolve([]),
      fixedIds.length
        ? prisma.entrenadorLiquidacionObligacionAplicacion.findMany({
            where: {
              gym_id: gymId,
              obligacion_id: { in: fixedIds },
              is_deleted: false,
            },
          })
        : Promise.resolve([]),
    ]);
    const paymentIds = [...new Set(accruals.map((row) => row.pago_cliente_id))];
    const paymentMemberships = paymentIds.length
      ? await prisma.pagoMembresiaAplicacion.findMany({
          where: { gym_id: gymId, pago_cliente_id: { in: paymentIds } },
          orderBy: { created_at: "asc" },
        })
      : [];
    const membershipFromPayment = new Map<string, string>();
    for (const row of paymentMemberships) {
      if (!membershipFromPayment.has(row.pago_cliente_id)) {
        membershipFromPayment.set(row.pago_cliente_id, row.membresia_id);
      }
    }
    const membershipIds = [...new Set(accruals.flatMap((row) => {
      const id = row.membresia_id ?? membershipFromPayment.get(row.pago_cliente_id);
      return id ? [id] : [];
    }))];
    const [memberships, pauses] = await Promise.all([
      membershipIds.length
        ? prisma.membresiaCliente.findMany({
            where: { gym_id: gymId, membresia_id: { in: membershipIds } },
          })
        : Promise.resolve([]),
      membershipIds.length
        ? prisma.membresiaPausa.findMany({
            where: { gym_id: gymId, membresia_id: { in: membershipIds } },
          })
        : Promise.resolve([]),
    ]);
    const clientIds = [...new Set(memberships.map((row) => row.ci))];
    const planIds = [...new Set(accruals.map((row) => row.id_planes_pago))];
    const [clients, plans] = await Promise.all([
      clientIds.length
        ? prisma.cliente.findMany({
            where: { gym_id: gymId, ci: { in: clientIds } },
            select: { ci: true, nombres: true, apellidos: true },
          })
        : Promise.resolve([]),
      planIds.length
        ? prisma.planesPago.findMany({
            where: { gym_id: gymId, id_planes_pago: { in: planIds } },
            select: { id_planes_pago: true, nombre_plan_pago: true },
          })
        : Promise.resolve([]),
    ]);

    const trainerById = new Map(trainers.map((row) => [
      row.id_entrenador,
      `${row.nombres_entrenador} ${row.apellidos_entrenador}`.trim(),
    ]));
    const currencyById = new Map(currencies.map((row) => [row.moneda_id, row.codigo]));
    const accrualById = new Map(accruals.map((row) => [row.devengo_id, row]));
    const membershipById = new Map(memberships.map((row) => [row.membresia_id, row]));
    const clientById = new Map(clients.map((row) => [row.ci, row]));
    const planById = new Map(plans.map((row) => [row.id_planes_pago, row.nombre_plan_pago]));
    const installmentApps = groupApplications(
      installmentApplications,
      (row) => row.cuota_id,
    );
    const fixedApps = groupApplications(fixedApplications, (row) => row.obligacion_id);
    const pausesByMembership = groupBy(pauses, (row) => row.membresia_id);

    const commissionCosts: TrainerServiceCostSnapshot[] = installments.map((row) => {
      const accrual = accrualById.get(row.devengo_id);
      const membershipId = accrual?.membresia_id ??
        (accrual ? membershipFromPayment.get(accrual.pago_cliente_id) : undefined) ?? null;
      const membership = membershipId ? membershipById.get(membershipId) : undefined;
      const client = membership ? clientById.get(membership.ci) : undefined;
      const membershipPauses = membershipId
        ? pausesByMembership.get(membershipId) ?? []
        : [];
      const calendarDates = [
        row.periodo_inicio,
        row.periodo_fin,
        row.fecha_programada,
        ...membershipPauses.flatMap((pause) =>
          pause.fecha_reanudacion
            ? [pause.fecha_pausa, pause.fecha_reanudacion]
            : [pause.fecha_pausa]
        ),
      ];
      return {
        costId: row.cuota_id,
        groupId: row.devengo_id,
        source: "COMISION",
        trainerId: row.id_entrenador,
        trainerName: trainerById.get(row.id_entrenador) ?? row.id_entrenador,
        membershipId,
        clientId: membership?.ci ?? null,
        clientName: client
          ? `${client.nombres} ${client.apellidos}`.trim()
          : membership?.ci ?? null,
        planId: accrual?.id_planes_pago ?? membership?.id_planes_pago ?? null,
        planName: membership?.plan_nombre_snapshot ??
          (accrual ? planById.get(accrual.id_planes_pago) : null) ?? null,
        currencyId: row.moneda_id,
        currencyCode: currencyById.get(row.moneda_id) ?? row.moneda_id,
        total: row.monto.toString(),
        earningMethod: accrual?.metodo_devengo ?? "PERIODOS_IGUALES",
        periodStart: normalizeCalendarDate(row.periodo_inicio),
        periodEnd: normalizeCalendarDate(row.periodo_fin),
        scheduledDate: normalizeCalendarDate(row.fecha_programada),
        state: row.estado,
        createdAt: row.created_at ?? row.updated_at,
        updatedAt: row.updated_at,
        normalizedLegacyCalendarDates: calendarDates.some(
          (value) => !isCanonicalCalendarDate(value),
        ),
        applications: installmentApps.get(row.cuota_id) ?? [],
        pauses: membershipPauses.map(mapPause),
      };
    });

    const fixedCosts: TrainerServiceCostSnapshot[] = fixedObligations.map((row) => {
      const calendarDates = [row.periodo_inicio, row.periodo_fin, row.fecha_programada];
      return {
        costId: row.obligacion_id,
        groupId: row.obligacion_id,
        source: "FIJO",
        trainerId: row.id_entrenador,
        trainerName: trainerById.get(row.id_entrenador) ?? row.id_entrenador,
        membershipId: null,
        clientId: null,
        clientName: null,
        planId: null,
        planName: null,
        currencyId: row.moneda_id,
        currencyCode: currencyById.get(row.moneda_id) ?? row.moneda_id,
        total: row.monto.toString(),
        earningMethod: row.metodo_prorrateo,
        periodStart: normalizeCalendarDate(row.periodo_inicio),
        periodEnd: normalizeCalendarDate(row.periodo_fin),
        scheduledDate: normalizeCalendarDate(row.fecha_programada),
        state: row.estado,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        normalizedLegacyCalendarDates: calendarDates.some(
          (value) => !isCanonicalCalendarDate(value),
        ),
        applications: fixedApps.get(row.obligacion_id) ?? [],
        pauses: [],
      };
    });
    return [...commissionCosts, ...fixedCosts];
  }

}

function mapPause(row: {
  fecha_pausa: Date;
  fecha_reanudacion: Date | null;
  created_at: Date | null;
  pausada_at: Date;
  deleted_at: Date | null;
}): TrainerServiceCostPauseSnapshot {
  return {
    start: normalizeCalendarDate(row.fecha_pausa),
    end: row.fecha_reanudacion
      ? normalizeCalendarDate(row.fecha_reanudacion)
      : null,
    createdAt: row.created_at ?? row.pausada_at,
    deletedAt: row.deleted_at,
  };
}

function groupApplications<T extends {
  monto_aplicado: unknown;
  estado: string;
  created_at: Date;
  updated_at: Date;
}>(rows: T[], keyOf: (row: T) => string) {
  const grouped = new Map<string, TrainerServiceCostApplicationSnapshot[]>();
  for (const row of rows) {
    if (row.estado !== "APLICADA" && row.estado !== "REVERSADA") continue;
    const key = keyOf(row);
    const values = grouped.get(key) ?? [];
    values.push({
      amount: String(row.monto_aplicado),
      state: row.estado,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    grouped.set(key, values);
  }
  return grouped;
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }
  return grouped;
}

export function isCanonicalCalendarDate(value: Date) {
  return value.getUTCHours() === 0 && value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0;
}

export function normalizeCalendarDate(value: Date) {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}
