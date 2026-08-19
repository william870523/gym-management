import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  hasPaidCommission,
  normalizeReversalReason,
  resolveMembershipAfterReversal,
} from "../../domain/payment-reversal-policy";
import {
  claveDeReversoDeCobro,
  puedeAnularElCobro,
  reversoDe,
  decidirCobro,
} from "../../domain/cobro-por-cuenta-ajena-policy";
import { anotarAsiento } from "../saldo-enlace/saldo-enlace.service";
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
      // Sin filtrar por sede: o el cobro está anulado o no lo está, y eso no
      // depende de quién pregunte. Con el filtro, la sede dueña del ingreso
      // podía volver a anular un cobro cruzado que la otra ya había anulado.
      const repeated = await tx.pagoReversion.findFirst({
        where: { pago_cliente_id: paymentId },
      });
      if (repeated) return this.present(repeated, true);
      const sameOperation = await tx.pagoReversion.findUnique({
        where: { operacion_id: operationId },
      });
      if (sameOperation) {
        throw new PaymentReversalError("Ese identificador de operación ya fue usado para otro cobro.", 409);
      }

      const payment = await tx.pagoCliente.findFirst({
        where: { pago_cliente_id: paymentId },
      });
      if (!payment) throw new PaymentReversalError("Cobro no encontrado.", 404);

      // §7.8: anula la sede que tiene el dinero, que en un cobro cruzado NO es
      // la dueña del ingreso. Antes se filtraba por `gym_id` —la dueña—, así
      // que la sede que iba a sacar los billetes de su caja era justamente la
      // única que no podía anularlo.
      const autoridad = puedeAnularElCobro({
        cobro: {
          gymId: String(payment.gym_id ?? ""),
          cobradoEnGymId: payment.cobrado_en_gym_id,
        },
        gymIdQueAnula: input.gymId,
      });
      if (!autoridad.permitido) {
        throw new PaymentReversalError(autoridad.motivo!, 403);
      }
      // Membresías, cuotas y comisiones cuelgan del cobro, y el cobro es de la
      // sede dueña del ingreso: se buscan por ella, no por quien anula.
      const gymDelCobro = String(payment.gym_id ?? "");
      if (payment.is_deleted) {
        throw new PaymentReversalError(
          "El cobro fue anulado por el flujo anterior y requiere conciliación manual.",
          409,
        );
      }

      const [applications, accruals, operator, paymentDetails] = await Promise.all([
        tx.pagoMembresiaAplicacion.findMany({
          where: { pago_cliente_id: paymentId, gym_id: gymDelCobro, is_deleted: false },
        }),
        tx.entrenadorComisionDevengo.findMany({
          where: { pago_cliente_id: paymentId, gym_id: gymDelCobro, is_deleted: false },
        }),
        tx.user.findFirst({
          where: { user_id: input.userId, gym_id: input.gymId, active: true, is_deleted: false },
          select: { user_nombre: true },
        }),
        tx.detallePago.findMany({
          where: { pago_cliente_id: paymentId, gym_id: gymDelCobro, is_deleted: false },
          select: { detalle_pago_id: true },
        }),
      ]);
      if (!operator) throw new PaymentReversalError("La cuenta operadora no está disponible.", 403);
      const accrualIds = accruals.map((item) => item.devengo_id);
      const installments = accrualIds.length === 0 ? [] : await tx.entrenadorComisionCuota.findMany({
        where: { devengo_id: { in: accrualIds }, gym_id: gymDelCobro, is_deleted: false },
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
        where: { pago_detalle_id: { in: detailIds }, gym_id: gymDelCobro, is_deleted: false },
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
        await this.recordSync(tx, "membresia_cuota", "UPDATE", reopened.cuota_instancia_id, gymDelCobro, reopened);
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
        await this.recordSync(tx, "entrenador_comision_cuota", "UPDATE", updated.cuota_id, gymDelCobro, updated);
      }
      for (const accrual of accruals) {
        if (accrual.estado === "ANULADO") continue;
        const updated = await tx.entrenadorComisionDevengo.update({
          where: { devengo_id: accrual.devengo_id },
          data: { estado: "ANULADO", cuotas_pagadas: 0, version: { increment: 1 }, updated_at: now },
        });
        await this.recordSync(tx, "entrenador_comision_devengo", "UPDATE", updated.devengo_id, gymDelCobro, updated);
      }

      for (const application of applications) {
        const updated = await tx.pagoMembresiaAplicacion.update({
          where: { aplicacion_id: application.aplicacion_id },
          data: { is_deleted: true, deleted_at: now, version: { increment: 1 }, updated_at: now },
        });
        await this.recordSync(tx, "pago_membresia_aplicacion", "DELETE", updated.aplicacion_id, gymDelCobro, updated);
      }

      const membershipIds = [...new Set(applications.map((item) => item.membresia_id))];
      const membershipsPending: string[] = [];
      let pausesCancelled = 0;
      let requestsCancelled = 0;
      let assignmentsPending = 0;
      for (const membershipId of membershipIds) {
        const membership = await tx.membresiaCliente.findFirst({
          where: { membresia_id: membershipId, gym_id: gymDelCobro, is_deleted: false },
        });
        if (!membership) continue;
        const remainingApplications = await tx.pagoMembresiaAplicacion.findMany({
          where: { membresia_id: membershipId, gym_id: gymDelCobro, is_deleted: false },
        });
        const remainingPaymentIds = [...new Set(remainingApplications.map((item) => item.pago_cliente_id))];
        const validPayments = remainingPaymentIds.length === 0 ? [] : await tx.pagoCliente.findMany({
          where: {
            pago_cliente_id: { in: remainingPaymentIds },
            gym_id: gymDelCobro,
            is_deleted: false,
          },
          select: { pago_cliente_id: true },
        });
        const validIds = new Set(validPayments.map((item) => item.pago_cliente_id));
        const remainingPaid = remainingApplications
          .filter((item) => validIds.has(item.pago_cliente_id))
          .reduce((sum, item) => sum + Number(item.monto_aplicado), 0);
        const quotaSchedule = await tx.membresiaCuota.findMany({
          where: { membresia_id: membershipId, gym_id: gymDelCobro, is_deleted: false },
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
        await this.recordSync(tx, "membresia_cliente", "UPDATE", membershipId, gymDelCobro, updated);
        if (resolution.state !== "PENDIENTE_PAGO") continue;
        membershipsPending.push(membershipId);

        const pauses = await tx.membresiaPausa.findMany({
          where: { membresia_id: membershipId, gym_id: gymDelCobro, estado: "ACTIVA", is_deleted: false },
        });
        for (const pause of pauses) {
          const cancelled = await tx.membresiaPausa.update({
            where: { pausa_id: pause.pausa_id },
            data: { estado: "CANCELADA", activa_clave: null, version: { increment: 1 }, updated_at: now },
          });
          pausesCancelled++;
          await this.recordSync(tx, "membresia_pausa", "UPDATE", cancelled.pausa_id, gymDelCobro, cancelled);
        }

        const requests = await tx.membresiaSolicitud.findMany({
          where: {
            membresia_id: membershipId,
            gym_id: gymDelCobro,
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
          await this.recordSync(tx, "membresia_solicitud", "UPDATE", cancelled.solicitud_id, gymDelCobro, cancelled);
        }

        const assignments = await tx.membresiaEntrenadorAsignacion.findMany({
          where: { membresia_id: membershipId, gym_id: gymDelCobro, estado: "ACTIVA", is_deleted: false },
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
          await this.recordSync(tx, "membresia_entrenador_asignacion", "UPDATE", pending.asignacion_id, gymDelCobro, pending);
        }
      }

      // La proyección del socio va **solo a su sede**, no a las dos. Mandarla
      // también a la que tiene el efectivo parecía simetría con el cobro y no
      // lo es: al aplicarla, esa instalación reescribe `gym_id` con la suya y
      // se apropia del socio. Lo que la sede del efectivo necesita es el cobro,
      // no la titularidad del miembro; para verlo está `cliente_visitante`.
      const updatedClient = await this.rebuildClientProjection(
        tx,
        payment.ci,
        gymDelCobro,
        now,
      );
      const deletedPayment = await tx.pagoCliente.update({
        where: { pago_cliente_id: paymentId },
        data: { is_deleted: true, deleted_at: now, version: { increment: 1 }, updated_at: now },
      });
      await this.recordSyncEnCadaSede(
        tx,
        "pago_cliente",
        "DELETE",
        paymentId,
        this.alcanceDelCobro(payment),
        deletedPayment,
      );

      // §7.8: «el contraasiento debe deshacer también el saldo entre sedes.
      // Nunca dejar el reverso a medias en una de las dos». Sin esto se
      // devolvía el dinero y la deuda seguía viva para siempre: la sede que
      // cobró aparecía debiendo un efectivo que ya había sacado de su caja.
      const asientoDeshecho = await this.deshacerSaldoDelCobro(
        tx,
        payment,
        paymentId,
        now,
      );

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
        // Se declara aunque sea nulo: «no había saldo que deshacer» y «se me
        // olvidó deshacerlo» se leen igual en un resumen que lo omite.
        saldo_entre_sedes_deshecho: asientoDeshecho,
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
          gym_id: gymDelCobro,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.recordSync(tx, "pago_reversion", "INSERT", reversal.reversion_id, gymDelCobro, reversal);
      await this.treasuryLedger.recordPaymentReversalInTx(
        tx,
        gymDelCobro,
        reversal,
      );
      return this.present(reversal, false);
    }, { timeout: 30_000 });
  }

  /**
   * Deshace el saldo entre sedes que dejó un cobro cruzado (§7.8).
   *
   * Devuelve el identificador del contraasiento, o `null` si el cobro no era
   * cruzado y no había saldo que deshacer.
   *
   * La decisión se **deriva del cobro**, no se vuelve a calcular: recalcularla
   * desde los datos de hoy daría otra respuesta el día que el socio haya
   * cambiado de sede o su plus haya caducado entre el cobro y la anulación, y
   * el contraasiento iría a parar a otra parte que el asiento original.
   */
  private async deshacerSaldoDelCobro(
    tx: Tx,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payment: any,
    paymentId: string,
    now: Date,
  ): Promise<string | null> {
    const cobradoEn = String(payment.cobrado_en_gym_id ?? "").trim();
    if (!cobradoEn) return null;

    // El asiento original dice cuánto y en qué moneda: el cobro pudo pagarse en
    // varios métodos y el saldo se anotó una vez, con su total.
    const original = await tx.saldoEnlaceAsiento.findFirst({
      where: {
        gym_id: cobradoEn,
        origen_tipo: "PAGO_CLIENTE",
        origen_id: paymentId,
        sentido: "GENERA",
        is_deleted: false,
      },
    });
    if (!original) return null;

    const decision = decidirCobro({
      clase: "PLAN",
      gymIdQueCobra: cobradoEn,
      gymIdDelSocio: String(payment.gym_id ?? ""),
    });
    const reverso = reversoDe(decision);
    const asiento = await anotarAsiento({
      tx,
      nowUtc: now,
      asiento: {
        asientoId: `sae-rev-${paymentId}`,
        saldo: reverso.saldo,
        monedaId: String(original.moneda_id),
        monto: String(original.monto),
        origenTipo: "REVERSO_PAGO_CLIENTE",
        origenId: paymentId,
        claveOrigen: claveDeReversoDeCobro(paymentId),
        claseCobro: String(original.clase_cobro),
        ci: original.ci ?? null,
        ocurridoAt: now,
        fechaNegocio: original.fecha_negocio ?? now,
        sourceDevice: null,
      },
      emitirEvento: (fila) =>
        this.recordSync(tx, "saldo_enlace_asiento", "INSERT", fila.asiento_id, cobradoEn, fila),
    });
    return String(asiento.asiento_id);
  }

  private async rebuildClientProjection(
    tx: Tx,
    ci: string,
    gymId: string,
    now: Date,
    alcance: string[] = [gymId],
  ) {
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
    await this.recordSyncEnCadaSede(tx, "cliente", "UPDATE", client.ci, alcance, client);
    return client;
  }

  private appendNote(current: string | null, note: string) {
    return current?.trim() ? `${current.trim()}\n${note}` : note;
  }

  /**
   * A qué sedes tiene que llegar la consecuencia de anular este cobro.
   *
   * Un cobro cruzado alcanza a **dos** instalaciones —la dueña del ingreso y la
   * que se quedó el efectivo—, y su anulación tiene que alcanzar a las mismas.
   * Emitirla solo para la dueña deja a la otra con el cobro vivo en su base: la
   * huella lo cazó a los diez minutos de escribirlo, con el `is_deleted` en 1 de
   * un lado y en 0 del otro.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private alcanceDelCobro(payment: any): string[] {
    const dueña = String(payment.gym_id ?? "").trim();
    const cobradoEn = String(payment.cobrado_en_gym_id ?? "").trim();
    return cobradoEn && cobradoEn !== dueña ? [dueña, cobradoEn] : [dueña];
  }

  /** Emite el mismo evento para cada sede a la que alcanza. */
  private async recordSyncEnCadaSede(
    tx: Tx,
    entity: string,
    operation: string,
    entityId: string,
    gymIds: string[],
    payload: unknown,
  ) {
    for (const gymId of gymIds) {
      await this.recordSync(tx, entity, operation, entityId, gymId, payload);
    }
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
