import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { trustedClock } from "../../config/trusted-clock";
import {
  assertTreasuryRefundOutput,
  normalizeTreasuryRefundAction,
  normalizeTreasuryRefundReason,
  TreasuryRefundPolicyError,
} from "../../domain/treasury-refund-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { TreasuryLedgerService } from "./treasury-ledger.service";

type Tx = Prisma.TransactionClient;
const REFUND_ENTITY = "cliente_reembolso_tesoreria";
const REVERSAL_ENTITY = "cliente_reembolso_reversion";
const RESOLUTION_ENTITY = "membresia_ajuste_financiero";
const CREDIT_ENTITY = "cliente_credito";

export class TreasuryRefundError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export class TreasuryRefundService {
  private readonly treasuryLedger = new TreasuryLedgerService();

  async list(gymId: string, status?: unknown) {
    const requested = String(status ?? "").trim().toUpperCase();
    const resolutions = await prisma.membresiaAjusteFinanciero.findMany({
      where: { gym_id: gymId, tipo: "REEMBOLSO_PENDIENTE", is_deleted: false },
      orderBy: [{ registrada_at: "desc" }, { ajuste_financiero_id: "desc" }],
    });
    if (resolutions.length === 0) return [];
    const adjustmentIds = resolutions.map((row) => row.ajuste_financiero_id);
    const decisionIds = resolutions.map((row) => row.decision_id);
    const membershipIds = resolutions.map((row) => row.membresia_origen_id);
    const [refunds, decisions, memberships, currencies] = await Promise.all([
      prisma.clienteReembolsoTesoreria.findMany({
        where: { gym_id: gymId, ajuste_financiero_id: { in: adjustmentIds }, is_deleted: false },
        orderBy: [{ registrada_at: "desc" }, { reembolso_id: "desc" }],
      }),
      prisma.entrenadorBajaDecision.findMany({ where: { gym_id: gymId, decision_id: { in: decisionIds }, is_deleted: false } }),
      prisma.membresiaCliente.findMany({ where: { gym_id: gymId, membresia_id: { in: membershipIds }, is_deleted: false } }),
      prisma.moneda.findMany(),
    ]);
    const latestRefund = new Map<string, any>();
    for (const row of refunds) if (!latestRefund.has(row.ajuste_financiero_id)) latestRefund.set(row.ajuste_financiero_id, row);
    const decisionById = new Map(decisions.map((row) => [row.decision_id, row]));
    const membershipById = new Map(memberships.map((row) => [row.membresia_id, row]));
    const currencyById = new Map(currencies.map((row) => [row.moneda_id, row.codigo]));
    return resolutions.map((resolution) => {
      const refund = latestRefund.get(resolution.ajuste_financiero_id) ?? null;
      const decision = decisionById.get(resolution.decision_id);
      const membership = membershipById.get(resolution.membresia_origen_id);
      const derivedStatus = resolution.estado === "PENDIENTE_TESORERIA" ? "PENDIENTE" : refund?.estado ?? resolution.estado;
      return {
        ajuste_financiero_id: resolution.ajuste_financiero_id,
        expediente_id: resolution.expediente_id,
        decision_id: resolution.decision_id,
        reembolso_id: refund?.reembolso_id ?? null,
        comprobante_numero: refund?.comprobante_numero ?? null,
        estado: derivedStatus,
        ultimo_comprobante_estado: refund?.estado ?? null,
        ci: membership?.ci ?? decision?.socio_ci_snapshot ?? "",
        socio_nombre: decision?.socio_nombre_snapshot ?? membership?.ci ?? "Socio",
        plan_nombre: decision?.plan_nombre_snapshot ?? membership?.plan_nombre_snapshot ?? "Plan",
        membresia_id: resolution.membresia_origen_id,
        moneda_id: resolution.moneda_id,
        moneda_codigo: currencyById.get(resolution.moneda_id) ?? resolution.moneda_id,
        monto: Number(resolution.importe_reembolso),
        fecha_efectiva: resolution.fecha_efectiva,
        solicitado_at: resolution.registrada_at,
        solicitado_por: resolution.registrada_por_nombre_snapshot,
        motivo_solicitud: resolution.motivo,
        cuenta_id: refund?.cuenta_id ?? null,
        tipo_pago_id: refund?.tipo_pago_id ?? null,
        motivo_tesoreria: refund?.motivo ?? null,
        resuelto_at: refund?.registrada_at ?? null,
        resuelto_por: refund?.registrada_por_nombre_snapshot ?? null,
      };
    }).filter((row) => !requested || requested === "TODOS" || row.estado === requested);
  }

  async options(gymId: string) {
    const [accounts, paymentTypes] = await Promise.all([
      prisma.cuenta.findMany({ where: { gym_id: gymId, is_deleted: false }, orderBy: { nombre_cuenta: "asc" } }),
      prisma.tipoPago.findMany({ where: { activo: true, is_deleted: false }, orderBy: { nombre_tipo_pago: "asc" } }),
    ]);
    return {
      cuentas: accounts.map((row) => ({ cuenta_id: row.cuenta_id, nombre_cuenta: row.nombre_cuenta, moneda_id: row.moneda_id, tipo_pago_id: row.tipo_pago_id })),
      tipos_pago: paymentTypes.map((row) => ({ tipo_pago_id: row.tipo_pago_id, nombre_tipo_pago: row.nombre_tipo_pago })),
    };
  }

  async decide(input: {
    gymId: string; adjustmentId: string; operationId: string; action: unknown;
    accountId?: unknown; paymentTypeId?: unknown; reason: unknown; userId: string;
  }) {
    const operationId = this.operation(input.operationId);
    const action = normalizeTreasuryRefundAction(input.action);
    const reason = normalizeTreasuryRefundReason(input.reason);
    const accountId = String(input.accountId ?? "").trim() || null;
    const paymentTypeId = String(input.paymentTypeId ?? "").trim() || null;
    const repeated = await prisma.clienteReembolsoTesoreria.findUnique({ where: { operacion_id: operationId } });
    if (repeated) {
      if (repeated.gym_id !== input.gymId || repeated.ajuste_financiero_id !== input.adjustmentId) {
        throw new TreasuryRefundError("El identificador de operación ya fue usado en otro reembolso.", 409);
      }
      return this.receipt(input.gymId, repeated.reembolso_id);
    }
    const now = trustedClock.nowUtc();
    const refundId = await prisma.$transaction(async (tx) => {
      const context = await this.context(tx, input.gymId, input.adjustmentId);
      const amountMinor = Math.round(Number(context.resolution.importe_reembolso) * 100);
      assertTreasuryRefundOutput({ action, amountMinor, accountId, paymentTypeId });
      const operatorName = await this.identityName(tx, input.gymId, input.userId);
      if (action === "CONFIRMAR") {
        const [account, paymentType] = await Promise.all([
          tx.cuenta.findFirst({ where: { cuenta_id: accountId!, gym_id: input.gymId, moneda_id: context.resolution.moneda_id, is_deleted: false } }),
          tx.tipoPago.findFirst({ where: { tipo_pago_id: paymentTypeId!, activo: true, is_deleted: false } }),
        ]);
        if (!account) throw new TreasuryRefundError("La cuenta de salida no corresponde a la moneda del reembolso.", 409);
        if (!paymentType) throw new TreasuryRefundError("El método de salida no está disponible.", 409);
        if (account.tipo_pago_id && account.tipo_pago_id !== paymentTypeId) throw new TreasuryRefundError("La cuenta no corresponde al método de salida.", 409);
      }
      const id = randomUUID();
      const refund = await tx.clienteReembolsoTesoreria.create({
        data: {
          reembolso_id: id, ajuste_financiero_id: context.resolution.ajuste_financiero_id,
          operacion_id: operationId, comprobante_numero: this.receiptNumber(now, id),
          ci: context.membership.ci, membresia_id: context.membership.membresia_id,
          moneda_id: context.resolution.moneda_id, monto: context.resolution.importe_reembolso,
          estado: action === "CONFIRMAR" ? "CONFIRMADO" : "RECHAZADO_CREDITO",
          cuenta_id: action === "CONFIRMAR" ? accountId : null,
          tipo_pago_id: action === "CONFIRMAR" ? paymentTypeId : null,
          motivo: reason, registrada_por_user_id: input.userId,
          registrada_por_nombre_snapshot: operatorName, registrada_at: now,
          is_deleted: false, created_at: now, gym_id: input.gymId,
          source_device: "WEB_ADMIN", version: 1, updated_at: now, deleted_at: null,
        },
      });
      await this.recordSync(tx, REFUND_ENTITY, "INSERT", input.gymId, refund.reembolso_id, refund, operationId);
      await this.treasuryLedger.recordRefundInTx(tx, input.gymId, refund);
      let creditId: string | null = null;
      if (action === "RECHAZAR_ACREDITAR") {
        creditId = randomUUID();
        const credit = await tx.clienteCredito.create({
          data: {
            credito_id: creditId, ajuste_financiero_id: context.resolution.ajuste_financiero_id,
            ci: context.membership.ci, moneda_id: context.resolution.moneda_id,
            monto_original: context.resolution.importe_reembolso, saldo: context.resolution.importe_reembolso,
            estado: "DISPONIBLE", motivo: `TESORERIA_RECHAZADA: ${reason}`,
            generado_por_user_id: input.userId, generado_por_nombre_snapshot: operatorName,
            generado_at: now, is_deleted: false, created_at: now, gym_id: input.gymId,
            source_device: "WEB_ADMIN", version: 1, updated_at: now, deleted_at: null,
          },
        });
        await this.recordSync(tx, CREDIT_ENTITY, "INSERT", input.gymId, credit.credito_id, credit);
      }
      const resolution = await tx.membresiaAjusteFinanciero.update({
        where: { ajuste_financiero_id: context.resolution.ajuste_financiero_id },
        data: { estado: "APLICADA", version: { increment: 1 }, updated_at: now },
      });
      await this.recordSync(tx, RESOLUTION_ENTITY, "UPDATE", input.gymId, resolution.ajuste_financiero_id, resolution);
      const decision = await tx.entrenadorBajaDecision.update({
        where: { decision_id: context.decision.decision_id },
        data: {
          estado_ejecucion: "APLICADA", ejecutada_at: now,
          ejecucion_resultado_json: JSON.stringify({
            resolucion_financiera_id: resolution.ajuste_financiero_id,
            reembolso_id: refund.reembolso_id, resultado_tesoreria: refund.estado,
            importe: Number(refund.monto), credito_id: creditId,
          }),
          version: { increment: 1 }, updated_at: now,
        },
      });
      await this.recordSync(tx, "entrenador_baja_decision", "UPDATE", input.gymId, decision.decision_id, decision);
      return refund.reembolso_id;
    });
    return this.receipt(input.gymId, refundId);
  }

  async reverse(input: { gymId: string; refundId: string; operationId: string; reason: unknown; userId: string }) {
    const operationId = this.operation(input.operationId);
    const reason = normalizeTreasuryRefundReason(input.reason);
    const repeated = await prisma.clienteReembolsoReversion.findUnique({ where: { operacion_id: operationId } });
    if (repeated) {
      if (repeated.gym_id !== input.gymId || repeated.reembolso_id !== input.refundId) throw new TreasuryRefundError("El identificador de operación ya fue usado en otra reversión.", 409);
      return this.receipt(input.gymId, input.refundId);
    }
    const now = trustedClock.nowUtc();
    await prisma.$transaction(async (tx) => {
      const refund = await tx.clienteReembolsoTesoreria.findFirst({ where: { reembolso_id: input.refundId, gym_id: input.gymId, is_deleted: false } });
      if (!refund) throw new TreasuryRefundError("Comprobante de reembolso no encontrado.", 404);
      if (refund.estado !== "CONFIRMADO") throw new TreasuryRefundError("Solo un reembolso confirmado puede revertirse.", 409);
      const exists = await tx.clienteReembolsoReversion.findFirst({ where: { reembolso_id: refund.reembolso_id, gym_id: input.gymId, is_deleted: false } });
      if (exists) throw new TreasuryRefundError("Este reembolso ya fue revertido.", 409);
      const operatorName = await this.identityName(tx, input.gymId, input.userId);
      const resolution = await tx.membresiaAjusteFinanciero.findFirst({ where: { ajuste_financiero_id: refund.ajuste_financiero_id, gym_id: input.gymId, is_deleted: false } });
      if (!resolution) throw new TreasuryRefundError("Resolución financiera no encontrada.", 409);
      const reversal = await tx.clienteReembolsoReversion.create({
        data: {
          reversion_id: randomUUID(), reembolso_id: refund.reembolso_id,
          operacion_id: operationId, motivo: reason, monto: refund.monto,
          registrada_por_user_id: input.userId, registrada_por_nombre_snapshot: operatorName,
          registrada_at: now, is_deleted: false, created_at: now, gym_id: input.gymId,
          source_device: "WEB_ADMIN", version: 1, updated_at: now, deleted_at: null,
        },
      });
      await this.recordSync(tx, REVERSAL_ENTITY, "INSERT", input.gymId, reversal.reversion_id, reversal, operationId);
      await this.treasuryLedger.recordRefundReversalInTx(
        tx,
        input.gymId,
        reversal,
      );
      const updatedRefund = await tx.clienteReembolsoTesoreria.update({ where: { reembolso_id: refund.reembolso_id }, data: { estado: "ANULADO", version: { increment: 1 }, updated_at: now } });
      await this.recordSync(tx, REFUND_ENTITY, "UPDATE", input.gymId, updatedRefund.reembolso_id, updatedRefund);
      const updatedResolution = await tx.membresiaAjusteFinanciero.update({ where: { ajuste_financiero_id: resolution.ajuste_financiero_id }, data: { estado: "PENDIENTE_TESORERIA", version: { increment: 1 }, updated_at: now } });
      await this.recordSync(tx, RESOLUTION_ENTITY, "UPDATE", input.gymId, updatedResolution.ajuste_financiero_id, updatedResolution);
      const decision = await tx.entrenadorBajaDecision.update({
        where: { decision_id: resolution.decision_id },
        data: {
          estado_ejecucion: "ESPERA_TESORERIA", ejecutada_at: null,
          ejecucion_resultado_json: JSON.stringify({ resolucion_financiera_id: resolution.ajuste_financiero_id, reembolso_anulado_id: refund.reembolso_id, reversion_id: reversal.reversion_id }),
          version: { increment: 1 }, updated_at: now,
        },
      });
      await this.recordSync(tx, "entrenador_baja_decision", "UPDATE", input.gymId, decision.decision_id, decision);
    });
    return this.receipt(input.gymId, input.refundId);
  }

  async receipt(gymId: string, refundId: string) {
    const refund = await prisma.clienteReembolsoTesoreria.findFirst({ where: { reembolso_id: refundId, gym_id: gymId, is_deleted: false } });
    if (!refund) throw new TreasuryRefundError("Comprobante de reembolso no encontrado.", 404);
    const resolution = await prisma.membresiaAjusteFinanciero.findFirst({ where: { ajuste_financiero_id: refund.ajuste_financiero_id, gym_id: gymId } });
    const [decision, account, paymentType, currency, reversal] = await Promise.all([
      resolution ? prisma.entrenadorBajaDecision.findFirst({ where: { decision_id: resolution.decision_id, gym_id: gymId, is_deleted: false } }) : null,
      refund.cuenta_id ? prisma.cuenta.findFirst({ where: { cuenta_id: refund.cuenta_id, gym_id: gymId } }) : null,
      refund.tipo_pago_id ? prisma.tipoPago.findUnique({ where: { tipo_pago_id: refund.tipo_pago_id } }) : null,
      prisma.moneda.findUnique({ where: { moneda_id: refund.moneda_id } }),
      prisma.clienteReembolsoReversion.findFirst({ where: { reembolso_id: refund.reembolso_id, gym_id: gymId, is_deleted: false } }),
    ]);
    return {
      ...refund, monto: Number(refund.monto), socio_nombre: decision?.socio_nombre_snapshot ?? refund.ci,
      plan_nombre: decision?.plan_nombre_snapshot ?? "Plan", moneda_codigo: currency?.codigo ?? refund.moneda_id,
      cuenta_nombre: account?.nombre_cuenta ?? null, tipo_pago_nombre: paymentType?.nombre_tipo_pago ?? null,
      solicitud_motivo: resolution?.motivo ?? null, fecha_efectiva: resolution?.fecha_efectiva ?? null,
      reversion: reversal ? { ...reversal, monto: Number(reversal.monto) } : null,
    };
  }

  private async context(tx: Tx, gymId: string, adjustmentId: string) {
    const resolution = await tx.membresiaAjusteFinanciero.findFirst({
      where: { ajuste_financiero_id: adjustmentId, gym_id: gymId, tipo: "REEMBOLSO_PENDIENTE", estado: "PENDIENTE_TESORERIA", is_deleted: false },
    });
    if (!resolution) throw new TreasuryRefundError("La solicitud ya no está pendiente en Tesorería.", 409);
    const [decision, membership] = await Promise.all([
      tx.entrenadorBajaDecision.findFirst({ where: { decision_id: resolution.decision_id, gym_id: gymId, is_deleted: false } }),
      tx.membresiaCliente.findFirst({ where: { membresia_id: resolution.membresia_origen_id, gym_id: gymId, is_deleted: false } }),
    ]);
    if (!decision || !membership) throw new TreasuryRefundError("La solicitud perdió su contexto operativo.", 409);
    return { resolution, decision, membership };
  }

  private async identityName(tx: Tx, gymId: string, userId: string) {
    const user = await tx.user.findFirst({ where: { user_id: userId, gym_id: gymId, active: true, is_deleted: false } });
    if (!user) throw new TreasuryRefundError("La cuenta operadora no es válida.", 403);
    return user.user_nombre;
  }
  private operation(value: unknown) {
    const id = String(value ?? "").trim();
    if (id.length < 8 || id.length > 191) throw new TreasuryRefundError("La operación de Tesorería no es válida.");
    return id;
  }
  private receiptNumber(now: Date, id: string) { return `RMB-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`; }
  private async recordSync(tx: Tx, entity: string, operation: "INSERT" | "UPDATE", gymId: string, entityId: string, row: unknown, eventId: string = randomUUID()) {
    await tx.syncLog.create({
      data: { event_id: eventId, entidad: entity, operacion: operation, entidad_id: entityId, gym_id: gymId, payload_json: JSON.stringify(serialize(row)) },
    });
  }
}

export function asTreasuryRefundError(error: unknown) {
  if (error instanceof TreasuryRefundError) return error;
  if (error instanceof TreasuryRefundPolicyError) return new TreasuryRefundError(error.message);
  return null;
}
