import type { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { env } from "../../config/env";
import { trustedClock } from "../../config/trusted-clock";
import {
  buildFixedObligationSchedule,
  FixedObligationPolicyError,
} from "../../domain/fixed-obligation-policy";
import {
  calendarDateUtc,
  type CommissionEarningMethod,
  type PayoutFrequency,
} from "../../domain/compensation-profile-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { CompensationProfileService } from "./compensation-profile.service";

type Tx = Prisma.TransactionClient;
const ENTITY = "entrenador_obligacion_fija";

export class FixedObligationServiceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "FixedObligationServiceError";
  }
}

export class FixedObligationService {
  private readonly profiles = new CompensationProfileService();

  async materializeDue(gymId: string, requestedThrough?: unknown) {
    const now = trustedClock.nowUtc();
    return prisma.$transaction(async (tx) => {
      const today = await this.profiles.businessDateForInstant(tx, gymId, now);
      const through = requestedThrough === undefined || requestedThrough === null
        ? today
        : calendarDateUtc(requestedThrough, "La fecha de materialización");
      if (through.getTime() > today.getTime()) {
        throw new FixedObligationServiceError(
          "No se pueden generar obligaciones para un día comercial futuro.",
        );
      }
      const profiles = await tx.entrenadorCompensacionPerfil.findMany({
        where: {
          gym_id: gymId,
          is_deleted: false,
          activo: true,
          modalidad: { in: ["FIJO", "MIXTO"] },
          frecuencia_desembolso: { not: "EXTRAORDINARIA" },
          monto_fijo: { not: null },
          moneda_id: { not: null },
          fecha_inicio: { lt: through },
        },
        orderBy: [{ fecha_inicio: "asc" }, { perfil_id: "asc" }],
      });
      const existing = profiles.length
        ? await tx.entrenadorObligacionFija.findMany({
            where: {
              gym_id: gymId,
              perfil_compensacion_id: { in: profiles.map((row) => row.perfil_id) },
            },
          })
        : [];
      const keys = new Set(existing.map((row) => this.periodKey(
        row.perfil_compensacion_id,
        row.periodo_inicio,
        row.periodo_fin,
      )));
      let created = 0;
      for (const profile of profiles) {
        const schedule = buildFixedObligationSchedule({
          fixedAmount: profile.monto_fijo!.toFixed(2),
          profileStart: profile.fecha_inicio,
          profileEnd: profile.fecha_fin,
          throughDate: through,
          earningMethod: profile.metodo_devengo as CommissionEarningMethod,
          payoutFrequency: profile.frecuencia_desembolso as PayoutFrequency,
          cutoffDay: profile.dia_corte,
        });
        for (const period of schedule) {
          const key = this.periodKey(profile.perfil_id, period.periodStart, period.periodEnd);
          if (keys.has(key)) continue;
          const obligationId = this.stableId(key);
          const formula = {
            perfil_compensacion_id: profile.perfil_id,
            modalidad: profile.modalidad,
            monto_fijo_por_periodo: profile.monto_fijo!.toFixed(2),
            frecuencia_desembolso: profile.frecuencia_desembolso,
            dia_corte: profile.dia_corte,
            metodo_prorrateo: period.earningMethod,
            dias_cubiertos: period.coveredDays,
            dias_periodo: period.cycleDays,
          };
          const row = await tx.entrenadorObligacionFija.upsert({
            where: { obligacion_id: obligationId },
            create: {
              obligacion_id: obligationId,
              perfil_compensacion_id: profile.perfil_id,
              id_entrenador: profile.id_entrenador,
              moneda_id: profile.moneda_id!,
              periodo_inicio: period.periodStart,
              periodo_fin: period.periodEnd,
              fecha_programada: period.payableDate,
              monto: period.amount,
              estado: "PENDIENTE",
              metodo_prorrateo: period.earningMethod,
              dias_cubiertos: period.coveredDays,
              dias_periodo: period.cycleDays,
              formula_snapshot_json: JSON.stringify(formula),
              is_deleted: false,
              created_at: now,
              gym_id: gymId,
              source_device: "WEB_ADMIN",
              version: 1,
              updated_at: now,
              deleted_at: null,
            },
            update: {},
          });
          const eventId = this.stableId(`${ENTITY}:INSERT:${obligationId}`);
          await tx.syncLog.upsert({
            where: { event_id: eventId },
            create: {
              event_id: eventId,
              entidad: ENTITY,
              operacion: "INSERT",
              entidad_id: obligationId,
              gym_id: gymId,
              device_id: "WEB_ADMIN",
              payload_json: JSON.stringify(serialize(row)),
            },
            update: {},
          });
          keys.add(key);
          created += 1;
        }
      }
      return {
        business_date: through.toISOString().slice(0, 10),
        profiles_reviewed: profiles.length,
        created,
      };
    }, { timeout: 30_000 });
  }

  async list(gymId: string, status?: string | null) {
    await this.materializeDue(gymId);
    const requested = String(status ?? "").trim().toUpperCase();
    const rows = await prisma.entrenadorObligacionFija.findMany({
      where: {
        gym_id: gymId,
        is_deleted: false,
        ...(requested ? { estado: requested } : {}),
      },
      orderBy: [{ fecha_programada: "desc" }, { obligacion_id: "asc" }],
      take: 250,
    });
    const trainerIds = [...new Set(rows.map((row) => row.id_entrenador))];
    const currencyIds = [...new Set(rows.map((row) => row.moneda_id))];
    const [trainers, currencies] = await Promise.all([
      trainerIds.length
        ? prisma.entrenador.findMany({
            where: { gym_id: gymId, id_entrenador: { in: trainerIds } },
          })
        : [],
      currencyIds.length
        ? prisma.moneda.findMany({
            where: { moneda_id: { in: currencyIds }, is_deleted: false },
          })
        : [],
    ]);
    const trainerMap = new Map(trainers.map((row) => [
      row.id_entrenador,
      `${row.nombres_entrenador} ${row.apellidos_entrenador}`.trim(),
    ]));
    const currencyMap = new Map(currencies.map((row) => [row.moneda_id, row.codigo]));
    return rows.map((row) => ({
      ...row,
      monto: row.monto.toFixed(2),
      entrenador_nombre: trainerMap.get(row.id_entrenador) ?? row.id_entrenador,
      moneda_codigo: currencyMap.get(row.moneda_id) ?? row.moneda_id,
      formula_snapshot: JSON.parse(row.formula_snapshot_json || "{}"),
    }));
  }

  private periodKey(profileId: string, start: Date, end: Date) {
    return `${profileId}:${start.toISOString()}:${end.toISOString()}`;
  }

  private stableId(value: string) {
    const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
}

export function asFixedObligationServiceError(error: unknown) {
  if (error instanceof FixedObligationServiceError) return error;
  if (error instanceof FixedObligationPolicyError) {
    return new FixedObligationServiceError(error.message, 400);
  }
  return null;
}
