import type { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  buildInstallmentSchedule,
  PlanInstallmentPolicyError,
  type InstallmentSchemeInput,
} from "../../domain/plan-installment-policy";
import { serialize } from "../../shared/utils/serialize";

type Tx = Prisma.TransactionClient;

const SCHEME_ENTITY = "plan_cuota_esquema";
const MEMBERSHIP_QUOTA_ENTITY = "membresia_cuota";

export class PlanInstallmentServiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "PlanInstallmentServiceError";
  }
}

/**
 * R5.2 — Cuotas del cliente en planes largos, lado remoto.
 *
 * Espejo de `gym-local-api/src/application/membership/plan-installment.service.ts`
 * con dos diferencias obligadas por el remoto: el `gym_id` es explícito (sale
 * del token, nunca del cuerpo) y el rastro de sincronización se escribe en
 * `sync_log` en vez de `sync_outbox`.
 *
 * Todos los métodos reciben el `tx` de la operación: un cobro por cuotas debe
 * compartir una sola transacción, nunca abrir una por repositorio.
 */
export class PlanInstallmentService {
  /**
   * Define o reemplaza el esquema de cuotas de un plan.
   *
   * La política valida que los tramos sumen la duración y el precio del plan.
   * Los tramos que desaparecen se marcan borrados en vez de eliminarse, para
   * que la baja también viaje por sincronización.
   */
  async upsertScheme(
    tx: Tx,
    input: { gymId: string; planId: string; tranches: InstallmentSchemeInput[] },
  ) {
    const plan = await tx.planesPago.findFirst({
      where: { id_planes_pago: input.planId, gym_id: input.gymId, is_deleted: false },
    });
    if (!plan) {
      throw new PlanInstallmentServiceError("El plan no existe en este gimnasio.", 404);
    }

    // Valida suma de días == duración y suma de importes == precio.
    buildInstallmentSchedule({
      planPrice: plan.importe_plan_pago.toFixed(2),
      planDurationDays: plan.duracion_plan_pago,
      membershipStart: trustedClock.nowUtc(),
      scheme: input.tranches,
    });

    const now = trustedClock.nowUtc();
    await tx.planesPago.update({
      where: { id_planes_pago: input.planId },
      data: { acepta_cuotas: true, version: { increment: 1 }, updated_at: now },
    });

    const vigentes = new Set<number>();
    for (const tramo of input.tranches) {
      vigentes.add(tramo.numeroCuota);
      // Upsert por la clave natural (plan, número): tolera filas creadas con
      // otro id por fixtures o por sincronización desde local.
      const creado = await tx.planCuotaEsquema.upsert({
        where: {
          plan_id_numero_cuota: {
            plan_id: input.planId,
            numero_cuota: tramo.numeroCuota,
          },
        },
        create: {
          esquema_id: randomUUID(),
          gym_id: input.gymId,
          plan_id: input.planId,
          numero_cuota: tramo.numeroCuota,
          importe: tramo.importe,
          dias_cobertura: tramo.diasCobertura,
          orden: tramo.numeroCuota,
          created_at: now,
          updated_at: now,
        },
        update: {
          importe: tramo.importe,
          dias_cobertura: tramo.diasCobertura,
          orden: tramo.numeroCuota,
          is_deleted: false,
          deleted_at: null,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      await this.recordSync(
        tx,
        input.gymId,
        SCHEME_ENTITY,
        creado.esquema_id,
        creado,
        "INSERT",
      );
    }

    const anteriores = await tx.planCuotaEsquema.findMany({
      where: { plan_id: input.planId, gym_id: input.gymId, is_deleted: false },
    });
    for (const viejo of anteriores) {
      if (vigentes.has(viejo.numero_cuota)) continue;
      const borrado = await tx.planCuotaEsquema.update({
        where: { esquema_id: viejo.esquema_id },
        data: {
          is_deleted: true,
          deleted_at: now,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      await this.recordSync(
        tx,
        input.gymId,
        SCHEME_ENTITY,
        borrado.esquema_id,
        borrado,
        "UPDATE",
      );
    }

    return this.getScheme(tx, input.gymId, input.planId);
  }

  /** Devuelve el esquema vigente (no borrado) de un plan del gimnasio. */
  async getScheme(tx: Tx, gymId: string, planId: string) {
    const rows = await tx.planCuotaEsquema.findMany({
      where: { plan_id: planId, gym_id: gymId, is_deleted: false },
      orderBy: { numero_cuota: "asc" },
    });
    return rows.map((row) => ({
      esquemaId: row.esquema_id,
      numeroCuota: row.numero_cuota,
      importe: row.importe.toString(),
      diasCobertura: row.dias_cobertura,
    }));
  }

  /**
   * Materializa las cuotas al contratar por cuotas. Se llama al cobrar la
   * cuota 1: esa queda PAGADA y el resto PENDIENTE. Devuelve las cuotas y los
   * finales de cobertura del primer y del último tramo.
   */
  async materializeOnActivation(
    tx: Tx,
    input: {
      gymId: string;
      membershipId: string;
      planId: string;
      membershipStart: Date;
      pagoDetalleId?: string | null;
      paidQuota?: number;
    },
  ) {
    const schemeRows = await tx.planCuotaEsquema.findMany({
      where: { plan_id: input.planId, gym_id: input.gymId, is_deleted: false },
      orderBy: { numero_cuota: "asc" },
    });
    if (schemeRows.length === 0) {
      throw new PlanInstallmentServiceError(
        "El plan no tiene un esquema de cuotas definido.",
      );
    }
    const plan = await tx.planesPago.findFirst({
      where: { id_planes_pago: input.planId, gym_id: input.gymId },
      select: { importe_plan_pago: true, duracion_plan_pago: true },
    });
    if (!plan) {
      throw new PlanInstallmentServiceError("El plan no existe en este gimnasio.", 404);
    }

    const schedule = buildInstallmentSchedule({
      planPrice: plan.importe_plan_pago.toFixed(2),
      planDurationDays: plan.duracion_plan_pago,
      membershipStart: input.membershipStart,
      scheme: schemeRows.map((row) => ({
        numeroCuota: row.numero_cuota,
        importe: row.importe.toString(),
        diasCobertura: row.dias_cobertura,
      })),
    });

    const now = trustedClock.nowUtc();
    const paidQuota = input.paidQuota ?? 1;
    const materialized = [];
    for (const item of schedule) {
      const isPaid = item.numeroCuota === paidQuota;
      const estado = isPaid ? "PAGADA" : "PENDIENTE";
      const instanceId = membershipQuotaId(input.membershipId, item.numeroCuota);
      const created = await tx.membresiaCuota.upsert({
        where: { cuota_instancia_id: instanceId },
        create: {
          cuota_instancia_id: instanceId,
          gym_id: input.gymId,
          membresia_id: input.membershipId,
          numero_cuota: item.numeroCuota,
          importe: item.importe,
          dias_cobertura: item.diasCobertura,
          fecha_exigible: item.fechaExigible,
          fecha_cobertura_inicio: item.fechaCoberturaInicio,
          fecha_cobertura_fin: item.fechaCoberturaFinExclusive,
          estado,
          fecha_pagada: isPaid ? now : null,
          pago_detalle_id: isPaid ? (input.pagoDetalleId ?? null) : null,
          created_at: now,
          updated_at: now,
        },
        update: {
          estado,
          fecha_pagada: isPaid ? now : null,
          pago_detalle_id: isPaid ? (input.pagoDetalleId ?? null) : null,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      await this.recordSync(
        tx,
        input.gymId,
        MEMBERSHIP_QUOTA_ENTITY,
        created.cuota_instancia_id,
        created,
        "INSERT",
      );
      materialized.push(created);
    }

    const lastTranche = schedule[schedule.length - 1]!;
    return {
      cuotas: materialized,
      serviceEndExclusive: lastTranche.fechaCoberturaFinExclusive,
      firstTrancheEndExclusive: schedule[0]!.fechaCoberturaFinExclusive,
    };
  }

  /**
   * Marca una cuota como pagada, o ANTICIPADA si se paga antes de su fecha
   * exigible. Amplía `fecha_fin` de la membresía al final del tramo pagado si
   * era menor. Es idempotente: una cuota ya pagada se devuelve tal cual.
   */
  async payInstallment(
    tx: Tx,
    input: {
      gymId: string;
      membershipId: string;
      numeroCuota: number;
      pagoDetalleId?: string | null;
      nowUtc?: Date;
    },
  ) {
    const now = input.nowUtc ?? trustedClock.nowUtc();
    const instanceId = membershipQuotaId(input.membershipId, input.numeroCuota);
    const cuota = await tx.membresiaCuota.findFirst({
      where: {
        cuota_instancia_id: instanceId,
        gym_id: input.gymId,
        is_deleted: false,
      },
    });
    if (!cuota) {
      throw new PlanInstallmentServiceError(
        `La cuota ${input.numeroCuota} no existe para esta membresía.`,
        404,
      );
    }
    if (cuota.estado === "PAGADA" || cuota.estado === "ANTICIPADA") {
      return cuota;
    }
    const anticipada = now.getTime() < cuota.fecha_exigible.getTime();
    const updated = await tx.membresiaCuota.update({
      where: { cuota_instancia_id: instanceId },
      data: {
        estado: anticipada ? "ANTICIPADA" : "PAGADA",
        fecha_pagada: now,
        pago_detalle_id: input.pagoDetalleId ?? null,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    await this.recordSync(
      tx,
      input.gymId,
      MEMBERSHIP_QUOTA_ENTITY,
      updated.cuota_instancia_id,
      updated,
      "UPDATE",
    );

    const membership = await tx.membresiaCliente.findFirst({
      where: { membresia_id: input.membershipId, gym_id: input.gymId },
    });
    if (
      membership &&
      membership.fecha_fin.getTime() < cuota.fecha_cobertura_fin.getTime()
    ) {
      const extended = await tx.membresiaCliente.update({
        where: { membresia_id: input.membershipId },
        data: {
          fecha_fin: cuota.fecha_cobertura_fin,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      await this.recordSync(
        tx,
        input.gymId,
        "membresia_cliente",
        extended.membresia_id,
        extended,
        "UPDATE",
      );
    }

    return updated;
  }

  /** Lista las cuotas materializadas de una membresía, ordenadas por número. */
  async listMembershipQuotas(tx: Tx, gymId: string, membershipId: string) {
    return tx.membresiaCuota.findMany({
      where: { membresia_id: membershipId, gym_id: gymId, is_deleted: false },
      orderBy: { numero_cuota: "asc" },
    });
  }

  private async recordSync(
    tx: Tx,
    gymId: string,
    entity: string,
    entityId: string,
    payload: unknown,
    operation: "INSERT" | "UPDATE",
  ) {
    await tx.syncLog.create({
      data: {
        event_id: randomUUID(),
        entidad: entity,
        operacion: operation,
        entidad_id: entityId,
        gym_id: gymId,
        device_id: null,
        payload_json: JSON.stringify(serialize(payload)),
      },
    });
  }
}

/**
 * ID determinista de una cuota materializada. Debe coincidir con el de
 * `gym-local-api` para que la misma cuota converja en ambas bases al
 * sincronizar; por eso el hash es idéntico y no un UUID aleatorio.
 */
function membershipQuotaId(membershipId: string, numeroCuota: number) {
  return `mcuota-${hashOf(`${membershipId}|${numeroCuota}`)}`;
}

function hashOf(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export { PlanInstallmentPolicyError, SCHEME_ENTITY };
