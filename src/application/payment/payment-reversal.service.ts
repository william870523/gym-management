import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  hasPaidCommission,
  normalizeReversalReason,
  resolveMembershipAfterReversal,
} from "../../domain/payment-reversal-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { TreasuryLedgerService } from "../accounting/treasury-ledger.service";

type Tx = Prisma.TransactionClient;

export class PaymentReversalError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "PaymentReversalError";
  }
}

export function resolveInstallmentReversalProjection(input: {
  remainingPaid: number;
  currentState: string;
  currentActivatedAt: Date | null;
  quotas: Array<{ estado: string; fecha_cobertura_fin: Date }>;
}) {
  const covered = input.quotas.filter((item) => item.estado === "PAGADA" || item.estado === "ANTICIPADA");
  if (input.quotas.length === 0 || covered.length === 0) return null;
  return {
    paidAmount: Math.max(0, Math.round(input.remainingPaid * 100) / 100),
    state: input.currentState === "PAUSADA" ? "PAUSADA" : "ACTIVA",
    activatedAt: input.currentActivatedAt,
    coverageEnd: new Date(Math.max(...covered.map((item) => item.fecha_cobertura_fin.getTime()))),
  };
}

export class PaymentReversalService {
  private readonly treasuryLedger = new TreasuryLedgerService();

  async reverse(input: {
    paymentId: string;
    operationId: string;
    reason: string;
    userId: string;
    gymId: string;
  }) {
    const paymentId = input.paymentId.trim();
    const operationId = input.operationId.trim();
    if (!paymentId) throw new PaymentReversalError("El cobro es obligatorio.");
    if (!operationId) throw new PaymentReversalError("La operación de anulación es obligatoria.");
    const reason = (() => {
      try {
        return normalizeReversalReason(input.reason);
      } catch (error) {
        throw new PaymentReversalError((error as Error).message);
      }
    })();

    return prisma.$transaction(async (tx) => {
      const repeated = await tx.pagoReversion.findFirst({
        where: { pago_cliente_id: paymentId, gym_id: input.gymId },
      });
      if (repeated) return this.present(repeated, true);
      const sameOperation = await tx.pagoReversion.findUnique({
        where: { operacion_id: operationId },
      });
      if (sameOperation) {
        throw new PaymentReversalError("Ese identificador de operación ya fue usado para otro cobro.", 409);
      }

      const payment = await tx.pagoCliente.findFirst({
        where: { pago_cliente_id: paymentId, gym_id: input.gymId },
      });
      if (!payment) throw new PaymentReversalError("Cobro no encontrado.", 404);
      if (payment.is_deleted) {
        throw new PaymentReversalError(
          "El cobro fue anulado por el flujo anterior y requiere conciliación manual.",
          409,
        );
      }

      const [applications, accruals, operator, paymentDetails] = await Promise.all([
        tx.pagoMembresiaAplicacion.findMany({
          where: { pago_cliente_id: paymentId, gym_id: input.gymId, is_deleted: false },
        }),
        tx.entrenadorComisionDevengo.findMany({
          where: { pago_cliente_id: paymentId, gym_id: input.gymId, is_deleted: false },
        }),
        tx.user.findFirst({
          where: { user_id: input.userId, gym_id: input.gymId, active: true, is_deleted: false },
          select: { user_nombre: true },
        }),
        tx.detallePago.findMany({
          where: { pago_cliente_id: paymentId, gym_id: input.gymId, is_deleted: false },
          select: { detalle_pago_id: true },
        }),
      ]);
      if (!operator) throw new PaymentReversalError("La cuenta operadora no está disponible.", 403);
      const accrualIds = accruals.map((item) => item.devengo_id);
      const installments = accrualIds.length === 0 ? [] : await tx.entrenadorComisionCuota.findMany({
        where: { devengo_id: { in: accrualIds }, gym_id: input.gymId, is_deleted: false },
      });
      if (hasPaidCommission({
        accrualStates: accruals.map((item) => item.estado),
        paidInstallmentCounts: accruals.map((item) => item.cuotas_pagadas),
        installmentStates: installments.map((item) => item.estado),
      })) {
        throw new PaymentReversalError(
          "No se puede anular: ya existe una comisión pagada. Registre primero el contramovimiento de la liquidación.",
          409,
        );
      }

      const now = trustedClock.nowUtc();
      const detailIds = paymentDetails.map((item) => item.detalle_pago_id);
      const membershipInstallments = detailIds.length === 0 ? [] : await tx.membresiaCuota.findMany({
        where: { pago_detalle_id: { in: detailIds }, gym_id: input.gymId, is_deleted: false },
      });
      for (const installment of membershipInstallments) {
        const reopened = await tx.membresiaCuota.update({
          where: { cuota_instancia_id: installment.cuota_instancia_id },
          data: {
            estado: "PENDIENTE",
            fecha_pagada: null,
            pago_detalle_id: null,
            version: { increment: 1 },
            updated_at: now,
          },
        });
        await this.recordSync(tx, "membresia_cuota", "UPDATE", reopened.cuota_instancia_id, input.gymId, reopened);
      }
      for (const installment of installments) {
        if (installment.estado === "ANULADO") continue;
        const updated = await tx.entrenadorComisionCuota.update({
          where: { cuota_id: installment.cuota_id },
          data: {
            estado: "ANULADO",
            notas: this.appendNote(installment.notas, `Anulada por reversión del cobro ${paymentId}.`),
            version: { increment: 1 },
            updated_at: now,
          },
        });
        await this.recordSync(tx, "entrenador_comision_cuota", "UPDATE", updated.cuota_id, input.gymId, updated);
      }
      for (const accrual of accruals) {
        if (accrual.estado === "ANULADO") continue;
        const updated = await tx.entrenadorComisionDevengo.update({
          where: { devengo_id: accrual.devengo_id },
          data: { estado: "ANULADO", cuotas_pagadas: 0, version: { increment: 1 }, updated_at: now },
        });
        await this.recordSync(tx, "entrenador_comision_devengo", "UPDATE", updated.devengo_id, input.gymId, updated);
      }

      for (const application of applications) {
        const updated = await tx.pagoMembresiaAplicacion.update({
          where: { aplicacion_id: application.aplicacion_id },
          data: { is_deleted: true, deleted_at: now, version: { increment: 1 }, updated_at: now },
        });
        await this.recordSync(tx, "pago_membresia_aplicacion", "DELETE", updated.aplicacion_id, input.gymId, updated);
      }

      const membershipIds = [...new Set(applications.map((item) => item.membresia_id))];
      const membershipsPending: string[] = [];
      let pausesCancelled = 0;
      let requestsCancelled = 0;
      let assignmentsPending = 0;
      for (const membershipId of membershipIds) {
        const membership = await tx.membresiaCliente.findFirst({
          where: { membresia_id: membershipId, gym_id: input.gymId, is_deleted: false },
        });
        if (!membership) continue;
        const remainingApplications = await tx.pagoMembresiaAplicacion.findMany({
          where: { membresia_id: membershipId, gym_id: input.gymId, is_deleted: false },
        });
        const remainingPaymentIds = [...new Set(remainingApplications.map((item) => item.pago_cliente_id))];
        const validPayments = remainingPaymentIds.length === 0 ? [] : await tx.pagoCliente.findMany({
          where: {
            pago_cliente_id: { in: remainingPaymentIds },
            gym_id: input.gymId,
            is_deleted: false,
          },
          select: { pago_cliente_id: true },
        });
        const validIds = new Set(validPayments.map((item) => item.pago_cliente_id));
        const remainingPaid = remainingApplications
          .filter((item) => validIds.has(item.pago_cliente_id))
          .reduce((sum, item) => sum + Number(item.monto_aplicado), 0);
        const quotaSchedule = await tx.membresiaCuota.findMany({
          where: { membresia_id: membershipId, gym_id: input.gymId, is_deleted: false },
        });
        const installmentResolution = resolveInstallmentReversalProjection({
          remainingPaid,
          currentState: membership.estado,
          currentActivatedAt: membership.activada_at,
          quotas: quotaSchedule,
        });
        const resolution = installmentResolution ?? resolveMembershipAfterReversal({
          contractedAmount: Number(membership.precio_snapshot),
          remainingPaidAmount: remainingPaid,
          currentState: membership.estado,
          currentActivatedAt: membership.activada_at,
        });
        const coverageEnd = installmentResolution?.coverageEnd ?? null;
        const updated = await tx.membresiaCliente.update({
          where: { membresia_id: membershipId },
          data: {
            importe_pagado: resolution.paidAmount,
            estado: resolution.state,
            activada_at: resolution.activatedAt,
            ...(coverageEnd ? { fecha_fin: coverageEnd } : {}),
            version: { increment: 1 },
            updated_at: now,
          },
        });
        await this.recordSync(tx, "membresia_cliente", "UPDATE", membershipId, input.gymId, updated);
        if (resolution.state !== "PENDIENTE_PAGO") continue;
        membershipsPending.push(membershipId);

        const pauses = await tx.membresiaPausa.findMany({
          where: { membresia_id: membershipId, gym_id: input.gymId, estado: "ACTIVA", is_deleted: false },
        });
        for (const pause of pauses) {
          const cancelled = await tx.membresiaPausa.update({
            where: { pausa_id: pause.pausa_id },
            data: { estado: "CANCELADA", activa_clave: null, version: { increment: 1 }, updated_at: now },
          });
          pausesCancelled++;
          await this.recordSync(tx, "membresia_pausa", "UPDATE", cancelled.pausa_id, input.gymId, cancelled);
        }

        const requests = await tx.membresiaSolicitud.findMany({
          where: {
            membresia_id: membershipId,
            gym_id: input.gymId,
            estado: { in: ["PENDIENTE", "EN_DECISION"] },
            is_deleted: false,
          },
        });
        for (const request of requests) {
          const cancelled = await tx.membresiaSolicitud.update({
            where: { solicitud_id: request.solicitud_id },
            data: {
              estado: "CANCELADA",
              pendiente_clave: null,
              decision_motivo: `Cancelada automáticamente por reversión del cobro: ${reason}`,
              decidida_por_user_id: input.userId,
              decidida_por_nombre_snapshot: operator.user_nombre,
              decidida_at: now,
              version: { increment: 1 },
              updated_at: now,
            },
          });
          requestsCancelled++;
          await this.recordSync(tx, "membresia_solicitud", "UPDATE", cancelled.solicitud_id, input.gymId, cancelled);
        }

        const assignments = await tx.membresiaEntrenadorAsignacion.findMany({
          where: { membresia_id: membershipId, gym_id: input.gymId, estado: "ACTIVA", is_deleted: false },
        });
        for (const assignment of assignments) {
          const pending = await tx.membresiaEntrenadorAsignacion.update({
            where: { asignacion_id: assignment.asignacion_id },
            data: {
              estado: "PENDIENTE",
              motivo_cierre: "Pago de la membresía anulado",
              version: { increment: 1 },
              updated_at: now,
            },
          });
          assignmentsPending++;
          await this.recordSync(tx, "membresia_entrenador_asignacion", "UPDATE", pending.asignacion_id, input.gymId, pending);
        }
      }

      const updatedClient = await this.rebuildClientProjection(tx, payment.ci, input.gymId, now);
      const deletedPayment = await tx.pagoCliente.update({
        where: { pago_cliente_id: paymentId },
        data: { is_deleted: true, deleted_at: now, version: { increment: 1 }, updated_at: now },
      });
      await this.recordSync(tx, "pago_cliente", "DELETE", paymentId, input.gymId, deletedPayment);

      const summary = {
        aplicaciones_anuladas: applications.length,
        membresias_pendientes: membershipsPending,
        devengos_anulados: accruals.filter((item) => item.estado !== "ANULADO").length,
        cuotas_anuladas: installments.filter((item) => item.estado !== "ANULADO").length,
        cuotas_membresia_reabiertas: membershipInstallments.map((item) => item.cuota_instancia_id),
        pausas_canceladas: pausesCancelled,
        solicitudes_canceladas: requestsCancelled,
        asignaciones_pendientes: assignmentsPending,
        cliente_activo: updatedClient.activo,
      };
      const reversal = await tx.pagoReversion.create({
        data: {
          reversion_id: paymentId,
          pago_cliente_id: paymentId,
          operacion_id: operationId,
          tipo: "ANULACION",
          motivo: reason,
          ci: payment.ci,
          membresia_id: membershipIds.length === 1 ? membershipIds[0] : null,
          monto_total: payment.monto_total,
          moneda_id: payment.moneda_id,
          registrada_por_user_id: input.userId,
          registrada_por_nombre_snapshot: operator.user_nombre,
          registrada_at: now,
          resumen_json: JSON.stringify(summary),
          is_deleted: false,
          created_at: now,
          gym_id: input.gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.recordSync(tx, "pago_reversion", "INSERT", reversal.reversion_id, input.gymId, reversal);
      await this.treasuryLedger.recordPaymentReversalInTx(
        tx,
        input.gymId,
        reversal,
      );
      return this.present(reversal, false);
    }, { timeout: 30_000 });
  }

  private async rebuildClientProjection(tx: Tx, ci: string, gymId: string, now: Date) {
    const active = await tx.membresiaCliente.findFirst({
      where: { ci, gym_id: gymId, estado: { in: ["ACTIVA", "PAUSADA"] }, is_deleted: false },
      orderBy: [{ fecha_fin: "desc" }, { updated_at: "desc" }],
    });
    const pending = active ? null : await tx.membresiaCliente.findFirst({
      where: { ci, gym_id: gymId, estado: "PENDIENTE_PAGO", is_deleted: false },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
    });
    const projection = active ?? pending;
    const client = await tx.cliente.update({
      where: { ci },
      data: {
        activo: active?.estado === "ACTIVA",
        ...(projection ? {
          id_planes_pago: projection.id_planes_pago,
          id_entrenador: projection.id_entrenador,
          fecha_inicio: projection.fecha_inicio,
          fecha_fin: projection.fecha_fin,
        } : {}),
        version: { increment: 1 },
        updated_at: now,
      },
    });
    await this.recordSync(tx, "cliente", "UPDATE", client.ci, gymId, client);
    return client;
  }

  private appendNote(current: string | null, note: string) {
    return current?.trim() ? `${current.trim()}\n${note}` : note;
  }

  private async recordSync(
    tx: Tx,
    entity: string,
    operation: string,
    entityId: string,
    gymId: string,
    payload: unknown,
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

  private present(reversal: { [key: string]: any }, idempotent: boolean) {
    return {
      ...reversal,
      resumen: JSON.parse(String(reversal.resumen_json || "{}")),
      idempotent,
    };
  }
}
