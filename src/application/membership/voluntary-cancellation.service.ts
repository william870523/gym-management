import { createHash, randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import {
  calculateOffboardingFinancialDestination,
  calculateUnusedMembershipValue,
  normalizeFinancialResolutionReason,
  OffboardingFinancialPolicyError,
} from "../../domain/trainer-offboarding-financial-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { TrainerOffboardingExecutionService } from "../trainer/trainer-offboarding-execution.service";
import { MembershipPauseService } from "./membership-pause.service";

type Tx = Prisma.TransactionClient;
type ResolutionType = "CREDITO_CLIENTE" | "REEMBOLSO_PENDIENTE";
const RESOLUTION_ENTITY = "membresia_ajuste_financiero";
const CREDIT_ENTITY = "cliente_credito";
const REVERSAL_ENTITY = "membresia_cancelacion_reversion";
const DIRECT_PREFIX = "CANCELACION_VOLUNTARIA:";

export class VoluntaryCancellationError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export class VoluntaryCancellationService {
  private readonly clock = new MembershipPauseService();
  private readonly projections = new TrainerOffboardingExecutionService();

  async execute(input: {
    gymId: string; clientId: string; membershipId: string; operationId: string;
    type: unknown; reason: unknown; userId: string;
  }) {
    const operationId = this.operation(input.operationId);
    const type = this.type(input.type);
    const reason = this.reason(input.reason);
    const repeated = await prisma.membresiaAjusteFinanciero.findUnique({ where: { operacion_id: operationId } });
    if (repeated) {
      if (repeated.gym_id !== input.gymId || repeated.membresia_origen_id !== input.membershipId || !repeated.expediente_id.startsWith(DIRECT_PREFIX)) {
        throw new VoluntaryCancellationError("El identificador de operación ya fue usado en otra resolución.");
      }
      return this.status(input.gymId, input.clientId, input.membershipId);
    }
    const { nowUtc, businessToday } = await this.clock.operationContext(input.gymId);
    await prisma.$transaction(async (tx) => {
      const context = await this.context(tx, input.gymId, input.clientId, input.membershipId);
      if (context.resolution && !context.reversal) {
        throw new VoluntaryCancellationError("La membresía ya tiene una cancelación voluntaria registrada.");
      }
      const decisionBase = `${DIRECT_PREFIX}${input.membershipId}`;
      const previousCycles = await tx.membresiaAjusteFinanciero.count({
        where: {
          membresia_origen_id: input.membershipId,
          gym_id: input.gymId,
          expediente_id: { startsWith: decisionBase },
          is_deleted: false,
        },
      });
      const cycle = previousCycles + 1;
      const cycleIdentity = `${input.membershipId}:${cycle}`;
      const operatorName = await this.operator(tx, input.gymId, input.userId);
      const valuation = calculateUnusedMembershipValue({
        paidMinor: this.toMinor(context.membership.importe_pagado),
        durationDays: context.membership.duracion_dias_snapshot,
        start: context.membership.fecha_inicio, endExclusive: context.membership.fecha_fin,
        effectiveDate: businessToday, membershipState: context.membership.estado,
        pausedRemainingDays: context.pause?.dias_restantes_snapshot ?? null,
      });
      const destination = calculateOffboardingFinancialDestination({ type, unusedMinor: valuation.unusedMinor });
      if (type === "REEMBOLSO_PENDIENTE" && valuation.unusedMinor === 0) {
        throw new VoluntaryCancellationError("La membresía no tiene valor reembolsable.");
      }
      const assignments = await tx.membresiaEntrenadorAsignacion.findMany({
        where: { membresia_id: input.membershipId, gym_id: input.gymId, is_deleted: false, estado: { in: ["PENDIENTE", "ACTIVA"] } },
      });
      const applications = await tx.pagoMembresiaAplicacion.findMany({
        where: { membresia_id: input.membershipId, gym_id: input.gymId, is_deleted: false }, select: { pago_cliente_id: true },
      });
      const accruals = await tx.entrenadorComisionDevengo.findMany({
        where: {
          gym_id: input.gymId, is_deleted: false, estado: { not: "ANULADO" },
          OR: [{ membresia_id: input.membershipId }, ...(applications.length ? [{ pago_cliente_id: { in: applications.map((row) => row.pago_cliente_id) } }] : [])],
        },
      });
      const installments = accruals.length ? await tx.entrenadorComisionCuota.findMany({
        where: { devengo_id: { in: accruals.map((row) => row.devengo_id) }, gym_id: input.gymId, is_deleted: false, estado: { not: "ANULADO" }, periodo_fin: { gt: businessToday } },
      }) : [];
      for (const row of installments) {
        if (row.estado !== "PENDIENTE") throw new VoluntaryCancellationError("Existe una comisión futura pagada o parcial; requiere ajuste manual antes de cancelar.");
      }
      const snapshot = {
        version: 1,
        membresia: { estado: context.membership.estado, fecha_fin: context.membership.fecha_fin },
        pausa: context.pause ? { pausa_id: context.pause.pausa_id, estado: context.pause.estado, activa_clave: context.pause.activa_clave, fecha_reanudacion: context.pause.fecha_reanudacion, reanudada_at: context.pause.reanudada_at } : null,
        asignaciones: assignments.map((row) => ({ asignacion_id: row.asignacion_id, fecha_fin: row.fecha_fin, estado: row.estado, motivo_cierre: row.motivo_cierre })),
        cuotas_comision: installments.map((row) => ({ cuota_id: row.cuota_id, monto: row.monto, periodo_fin: row.periodo_fin, estado: row.estado, notas: row.notas })),
      };
      for (const row of assignments) {
        const updated = await tx.membresiaEntrenadorAsignacion.update({
          where: { asignacion_id: row.asignacion_id },
          data: { fecha_fin: businessToday, estado: row.fecha_inicio.getTime() >= businessToday.getTime() ? "CANCELADA" : "CERRADA", motivo_cierre: `CANCELACION_VOLUNTARIA:${operationId}`, version: { increment: 1 }, updated_at: nowUtc },
        });
        await this.recordSync(tx, "membresia_entrenador_asignacion", "UPDATE", input.gymId, updated.asignacion_id, updated);
      }
      if (context.pause) {
        const updated = await tx.membresiaPausa.update({
          where: { pausa_id: context.pause.pausa_id },
          data: { estado: "CANCELADA", activa_clave: null, fecha_reanudacion: businessToday, reanudada_at: nowUtc, version: { increment: 1 }, updated_at: nowUtc },
        });
        await this.recordSync(tx, "membresia_pausa", "UPDATE", input.gymId, updated.pausa_id, updated);
      }
      for (const row of installments) {
        const updated = await tx.entrenadorComisionCuota.update({
          where: { cuota_id: row.cuota_id },
          data: { estado: "ANULADO", notas: `Cancelación voluntaria ${operationId}`, version: { increment: 1 }, updated_at: nowUtc },
        });
        await this.recordSync(tx, "entrenador_comision_cuota", "UPDATE", input.gymId, updated.cuota_id, updated);
      }
      for (const accrual of accruals) {
        const remaining = await tx.entrenadorComisionCuota.count({ where: { devengo_id: accrual.devengo_id, estado: { not: "ANULADO" }, is_deleted: false } });
        if (remaining === 0) {
          const updated = await tx.entrenadorComisionDevengo.update({ where: { devengo_id: accrual.devengo_id }, data: { estado: "ANULADO", version: { increment: 1 }, updated_at: nowUtc } });
          await this.recordSync(tx, "entrenador_comision_devengo", "UPDATE", input.gymId, updated.devengo_id, updated);
        }
      }
      const membership = await tx.membresiaCliente.update({ where: { membresia_id: input.membershipId }, data: { estado: "CANCELADA", fecha_fin: businessToday, version: { increment: 1 }, updated_at: nowUtc } });
      await this.recordSync(tx, "membresia_cliente", "UPDATE", input.gymId, membership.membresia_id, membership);
      const adjustmentId = this.stableId("ajuste", cycleIdentity);
      const resolution = await tx.membresiaAjusteFinanciero.create({
        data: {
          ajuste_financiero_id: adjustmentId, operacion_id: operationId,
          expediente_id: `${decisionBase}:${cycle}`, decision_id: `${decisionBase}:${cycle}`,
          membresia_origen_id: input.membershipId, membresia_destino_id: null,
          tipo: type, estado: destination.state, plan_destino_id: null, id_entrenador_destino: null,
          moneda_id: context.membership.moneda_id, precio_origen: context.membership.precio_snapshot,
          importe_pagado_origen: context.membership.importe_pagado,
          valor_no_consumido: this.money(valuation.unusedMinor), precio_destino: null,
          credito_aplicado: 0, importe_pendiente: 0,
          saldo_credito_generado: this.money(destination.remainingCreditMinor),
          importe_reembolso: this.money(destination.refundMinor), fecha_efectiva: businessToday,
          motivo: reason, formula_snapshot_json: JSON.stringify(serialize({ valoracion: valuation, restauracion: snapshot })),
          registrada_por_user_id: input.userId, registrada_por_nombre_snapshot: operatorName,
          registrada_at: nowUtc, is_deleted: false, created_at: nowUtc, gym_id: input.gymId,
          source_device: null, version: 1, updated_at: nowUtc, deleted_at: null,
        },
      });
      await this.recordSync(tx, RESOLUTION_ENTITY, "INSERT", input.gymId, resolution.ajuste_financiero_id, resolution, operationId);
      if (type === "CREDITO_CLIENTE" && destination.remainingCreditMinor > 0) {
        const credit = await tx.clienteCredito.create({
          data: {
            credito_id: this.stableId("credito", cycleIdentity), ajuste_financiero_id: adjustmentId, ci: input.clientId,
            moneda_id: context.membership.moneda_id, monto_original: this.money(destination.remainingCreditMinor),
            saldo: this.money(destination.remainingCreditMinor), estado: "DISPONIBLE",
            motivo: `CANCELACION_VOLUNTARIA: ${reason}`, generado_por_user_id: input.userId,
            generado_por_nombre_snapshot: operatorName, generado_at: nowUtc,
            is_deleted: false, created_at: nowUtc, gym_id: input.gymId,
            source_device: null, version: 1, updated_at: nowUtc, deleted_at: null,
          },
        });
        await this.recordSync(tx, CREDIT_ENTITY, "INSERT", input.gymId, credit.credito_id, credit);
      }
      await this.projections.refreshClientProjection(tx, input.gymId, input.clientId, nowUtc);
    });
    return this.status(input.gymId, input.clientId, input.membershipId);
  }

  async reverse(input: { gymId: string; clientId: string; membershipId: string; operationId: string; reason: unknown; userId: string }) {
    const operationId = this.operation(input.operationId);
    const reason = this.reason(input.reason);
    const repeated = await prisma.membresiaCancelacionReversion.findUnique({ where: { operacion_id: operationId } });
    if (repeated) {
      if (repeated.gym_id !== input.gymId || repeated.membresia_id !== input.membershipId) throw new VoluntaryCancellationError("La operación ya fue usada en otra reversión.");
      return this.status(input.gymId, input.clientId, input.membershipId);
    }
    const now = (await this.clock.operationContext(input.gymId)).nowUtc;
    await prisma.$transaction(async (tx) => {
      const context = await this.context(tx, input.gymId, input.clientId, input.membershipId, true);
      const resolution = context.resolution;
      if (!resolution) throw new VoluntaryCancellationError("Cancelación voluntaria no encontrada.", 404);
      if (context.reversal) throw new VoluntaryCancellationError("Esta cancelación ya fue revertida.");
      const refund = await tx.clienteReembolsoTesoreria.findFirst({ where: { ajuste_financiero_id: resolution.ajuste_financiero_id, gym_id: input.gymId, is_deleted: false } });
      if (refund) throw new VoluntaryCancellationError("Tesorería ya procesó esta solicitud; revierta primero su comprobante.");
      const credit = await tx.clienteCredito.findFirst({ where: { ajuste_financiero_id: resolution.ajuste_financiero_id, gym_id: input.gymId, is_deleted: false } });
      if (credit && Number(credit.saldo) !== Number(credit.monto_original)) throw new VoluntaryCancellationError("El crédito ya fue utilizado; revierta primero sus aplicaciones.");
      const operatorName = await this.operator(tx, input.gymId, input.userId);
      const restore = (JSON.parse(resolution.formula_snapshot_json) as any)?.restauracion;
      if (!restore?.membresia) throw new VoluntaryCancellationError("La cancelación no conserva un snapshot reversible.");
      for (const row of restore.asignaciones ?? []) {
        const updated = await tx.membresiaEntrenadorAsignacion.update({ where: { asignacion_id: row.asignacion_id }, data: { fecha_fin: row.fecha_fin ? new Date(row.fecha_fin) : null, estado: row.estado, motivo_cierre: row.motivo_cierre, version: { increment: 1 }, updated_at: now } });
        await this.recordSync(tx, "membresia_entrenador_asignacion", "UPDATE", input.gymId, updated.asignacion_id, updated);
      }
      if (restore.pausa) {
        const updated = await tx.membresiaPausa.update({ where: { pausa_id: restore.pausa.pausa_id }, data: { estado: restore.pausa.estado, activa_clave: restore.pausa.activa_clave, fecha_reanudacion: restore.pausa.fecha_reanudacion ? new Date(restore.pausa.fecha_reanudacion) : null, reanudada_at: restore.pausa.reanudada_at ? new Date(restore.pausa.reanudada_at) : null, version: { increment: 1 }, updated_at: now } });
        await this.recordSync(tx, "membresia_pausa", "UPDATE", input.gymId, updated.pausa_id, updated);
      }
      for (const row of restore.cuotas_comision ?? []) {
        const updated = await tx.entrenadorComisionCuota.update({ where: { cuota_id: row.cuota_id }, data: { monto: row.monto, periodo_fin: new Date(row.periodo_fin), estado: row.estado, notas: row.notas, version: { increment: 1 }, updated_at: now } });
        await this.recordSync(tx, "entrenador_comision_cuota", "UPDATE", input.gymId, updated.cuota_id, updated);
        const accrual = await tx.entrenadorComisionDevengo.update({ where: { devengo_id: updated.devengo_id }, data: { estado: "PENDIENTE", version: { increment: 1 }, updated_at: now } });
        await this.recordSync(tx, "entrenador_comision_devengo", "UPDATE", input.gymId, accrual.devengo_id, accrual);
      }
      const membership = await tx.membresiaCliente.update({ where: { membresia_id: input.membershipId }, data: { estado: restore.membresia.estado, fecha_fin: new Date(restore.membresia.fecha_fin), version: { increment: 1 }, updated_at: now } });
      await this.recordSync(tx, "membresia_cliente", "UPDATE", input.gymId, membership.membresia_id, membership);
      if (credit) {
        const updated = await tx.clienteCredito.update({ where: { credito_id: credit.credito_id }, data: { estado: "ANULADO", saldo: 0, version: { increment: 1 }, updated_at: now } });
        await this.recordSync(tx, CREDIT_ENTITY, "UPDATE", input.gymId, updated.credito_id, updated);
      }
      const updatedResolution = await tx.membresiaAjusteFinanciero.update({ where: { ajuste_financiero_id: resolution.ajuste_financiero_id }, data: { estado: "REVERTIDA", version: { increment: 1 }, updated_at: now } });
      await this.recordSync(tx, RESOLUTION_ENTITY, "UPDATE", input.gymId, updatedResolution.ajuste_financiero_id, updatedResolution);
      const reversal = await tx.membresiaCancelacionReversion.create({
        data: {
          reversion_id: randomUUID(), ajuste_financiero_id: resolution.ajuste_financiero_id,
          operacion_id: operationId, membresia_id: input.membershipId, credito_id: credit?.credito_id ?? null,
          motivo: reason, estado_restaurado: restore.membresia.estado,
          fecha_fin_restaurada: new Date(restore.membresia.fecha_fin),
          registrada_por_user_id: input.userId, registrada_por_nombre_snapshot: operatorName,
          registrada_at: now, is_deleted: false, created_at: now, gym_id: input.gymId,
          source_device: null, version: 1, updated_at: now, deleted_at: null,
        },
      });
      await this.recordSync(tx, REVERSAL_ENTITY, "INSERT", input.gymId, reversal.reversion_id, reversal, operationId);
      await this.projections.refreshClientProjection(tx, input.gymId, input.clientId, now);
    });
    return this.status(input.gymId, input.clientId, input.membershipId);
  }

  async status(gymId: string, clientId: string, membershipId: string) {
    const context = await this.context(prisma as any, gymId, clientId, membershipId, true);
    const credit = context.resolution ? await prisma.clienteCredito.findFirst({ where: { ajuste_financiero_id: context.resolution.ajuste_financiero_id, gym_id: gymId, is_deleted: false } }) : null;
    const refund = context.resolution ? await prisma.clienteReembolsoTesoreria.findFirst({ where: { ajuste_financiero_id: context.resolution.ajuste_financiero_id, gym_id: gymId, is_deleted: false } }) : null;
    return {
      membresia_id: membershipId, estado_membresia: context.membership.estado,
      cancelacion: context.resolution ? {
        ajuste_financiero_id: context.resolution.ajuste_financiero_id,
        tipo: context.resolution.tipo, estado: context.resolution.estado,
        valor_no_consumido: Number(context.resolution.valor_no_consumido), importe_reembolso: Number(context.resolution.importe_reembolso),
        credito: credit ? { credito_id: credit.credito_id, saldo: Number(credit.saldo), estado: credit.estado } : null,
        tesoreria: refund ? { reembolso_id: refund.reembolso_id, estado: refund.estado } : null,
        revertida: Boolean(context.reversal),
      } : null,
    };
  }

  private async context(tx: any, gymId: string, clientId: string, membershipId: string, allowCancelled = false) {
    const membership = await tx.membresiaCliente.findFirst({ where: { membresia_id: membershipId, ci: clientId, gym_id: gymId, is_deleted: false } });
    if (!membership) throw new VoluntaryCancellationError("Membresía no encontrada.", 404);
    if (!allowCancelled && !["ACTIVA", "PAUSADA", "PENDIENTE_PAGO"].includes(membership.estado)) throw new VoluntaryCancellationError("Esta membresía no admite cancelación voluntaria.");
    const resolution = await tx.membresiaAjusteFinanciero.findFirst({
      where: {
        membresia_origen_id: membershipId,
        gym_id: gymId,
        expediente_id: { startsWith: `${DIRECT_PREFIX}${membershipId}` },
        is_deleted: false,
      },
      orderBy: [{ registrada_at: "desc" }, { ajuste_financiero_id: "desc" }],
    });
    const reversal = resolution ? await tx.membresiaCancelacionReversion.findFirst({ where: { ajuste_financiero_id: resolution.ajuste_financiero_id, gym_id: gymId, is_deleted: false } }) : null;
    const pause = membership.estado === "PAUSADA" ? await tx.membresiaPausa.findUnique({ where: { activa_clave: membershipId } }) : null;
    return { membership, resolution, reversal, pause };
  }
  private async operator(tx: Tx, gymId: string, userId: string) {
    const user = await tx.user.findFirst({ where: { user_id: userId, gym_id: gymId, active: true, is_deleted: false } });
    if (!user) throw new VoluntaryCancellationError("La cuenta administradora no es válida.", 403);
    return user.user_nombre;
  }
  private operation(value: unknown) {
    const id = String(value ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new VoluntaryCancellationError("operation_id debe ser un UUID válido.", 400);
    return id;
  }
  private type(value: unknown): ResolutionType {
    const type = String(value ?? "").trim().toUpperCase();
    if (type !== "CREDITO_CLIENTE" && type !== "REEMBOLSO_PENDIENTE") throw new VoluntaryCancellationError("El destino de la cancelación no es válido.", 400);
    return type;
  }
  private reason(value: unknown) {
    try { return normalizeFinancialResolutionReason(value); }
    catch (error) {
      if (error instanceof OffboardingFinancialPolicyError) throw new VoluntaryCancellationError(error.message, 400);
      throw error;
    }
  }
  private toMinor(value: unknown) { return Math.round(Number(value ?? 0) * 100); }
  private money(value: number) { return value / 100; }
  private stableId(kind: string, membershipId: string) {
    const chars = createHash("sha256").update(`cancelacion-voluntaria|${kind}|${membershipId}`).digest("hex").slice(0, 32).split("");
    chars[12] = "5";
    chars[16] = ((parseInt(chars[16]!, 16) & 0x3) | 0x8).toString(16);
    const value = chars.join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  private async recordSync(tx: Tx, entity: string, operation: "INSERT" | "UPDATE", gymId: string, entityId: string, row: unknown, eventId: string = randomUUID()) {
    await tx.syncLog.create({ data: { event_id: eventId, entidad: entity, operacion: operation, entidad_id: entityId, gym_id: gymId, payload_json: JSON.stringify(serialize(row)) } });
  }
}
