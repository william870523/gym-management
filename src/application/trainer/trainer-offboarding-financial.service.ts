import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  calculateOffboardingFinancialDestination,
  calculateUnusedMembershipValue,
  normalizeFinancialResolutionReason,
  OffboardingFinancialPolicyError,
  type OffboardingFinancialResolutionType,
} from "../../domain/trainer-offboarding-financial-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { PrismaPagoClienteRepository } from "../../infrastructure/repositories/PrismaPagoClienteRepository";
import { serialize } from "../../shared/utils/serialize";
import {
  TrainerOffboardingCaseError,
  TrainerOffboardingCaseService,
} from "./trainer-offboarding-case.service";
import { TrainerOffboardingExecutionService } from "./trainer-offboarding-execution.service";

type Tx = Prisma.TransactionClient;
const RESOLUTION_ENTITY = "membresia_ajuste_financiero";
const CREDIT_ENTITY = "cliente_credito";
const CREDIT_APPLICATION_ENTITY = "credito_membresia_aplicacion";

export class TrainerOffboardingFinancialService {
  private readonly cases = new TrainerOffboardingCaseService();
  private readonly execution = new TrainerOffboardingExecutionService();
  private readonly payments = new PrismaPagoClienteRepository();

  async preview(input: {
    gymId: string;
    trainerId: string;
    caseId: string;
    membershipId: string;
    type?: unknown;
    destinationPlanId?: unknown;
  }) {
    const context = await this.loadContext(prisma as any, input);
    const valuation = await this.valuation(prisma as any, input.gymId, context);
    const plans = await prisma.planesPago.findMany({
      where: {
        gym_id: input.gymId,
        activo: true,
        is_deleted: false,
        moneda_id: context.membership.moneda_id,
        id_planes_pago: { not: context.membership.id_planes_pago },
      },
      orderBy: [{ nombre_plan_pago: "asc" }, { id_planes_pago: "asc" }],
    });
    const requestedType = this.type(input.type, false);
    const destinationPlanId = String(input.destinationPlanId ?? "").trim();
    const plan = destinationPlanId
      ? plans.find((row) => row.id_planes_pago === destinationPlanId) ?? null
      : null;
    const destination = requestedType && (requestedType !== "CAMBIO_PLAN" || plan)
      ? calculateOffboardingFinancialDestination({
          type: requestedType,
          unusedMinor: valuation.unusedMinor,
          destinationPriceMinor: plan ? this.toMinor(plan.importe_plan_pago) : null,
        })
      : null;
    return {
      expediente_id: context.offboardingCase.expediente_id,
      decision_id: context.decision.decision_id,
      fecha_efectiva: context.offboardingCase.fecha_efectiva,
      socio: { ci: context.membership.ci, nombre: context.decision.socio_nombre_snapshot },
      membresia: {
        id: context.membership.membresia_id,
        plan_id: context.membership.id_planes_pago,
        plan_nombre: context.membership.plan_nombre_snapshot,
        estado: context.membership.estado,
        moneda_id: context.membership.moneda_id,
        precio: this.money(this.toMinor(context.membership.precio_snapshot)),
        pagado: this.money(this.toMinor(context.membership.importe_pagado)),
        fecha_inicio: context.membership.fecha_inicio,
        fecha_fin: context.membership.fecha_fin,
      },
      valoracion: this.presentValuation(valuation),
      destino: destination ? this.presentDestination(destination) : null,
      planes: plans.map((row) => ({
        id: row.id_planes_pago,
        nombre: row.nombre_plan_pago,
        precio: Number(row.importe_plan_pago),
        moneda_id: row.moneda_id,
        duracion_dias: row.duracion_plan_pago,
        incluye_entrenador: row.incluye_entrenador,
      })),
      resolucion_existente: context.resolution,
      reglas: {
        cambio_plan_misma_moneda: true,
        reembolso_requiere_tesoreria: true,
        credito_no_es_ingreso_de_caja: true,
      },
    };
  }

  async resolve(input: {
    gymId: string;
    trainerId: string;
    caseId: string;
    membershipId: string;
    operationId: string;
    userId: string;
    type: unknown;
    destinationPlanId?: unknown;
    targetTrainerId?: unknown;
    reason: unknown;
  }) {
    const operationId = input.operationId.trim();
    if (operationId.length < 8) throw new TrainerOffboardingCaseError("La operación financiera no es válida.");
    const repeated = await prisma.membresiaAjusteFinanciero.findFirst({
      where: { operacion_id: operationId, gym_id: input.gymId },
    });
    if (repeated) {
      if (repeated.expediente_id !== input.caseId || repeated.membresia_origen_id !== input.membershipId) {
        throw new TrainerOffboardingCaseError("El identificador de operación ya fue usado en otra resolución.", 409);
      }
      return this.cases.getById(input.gymId, input.trainerId, input.caseId);
    }
    const type = this.type(input.type, true)!;
    const reason = normalizeFinancialResolutionReason(input.reason);
    const now = trustedClock.nowUtc();

    await prisma.$transaction(async (tx) => {
      const context = await this.loadContext(tx, input);
      if (context.resolution) throw new TrainerOffboardingCaseError("Esta membresía ya tiene una resolución financiera registrada.", 409);
      const businessToday = await this.execution.businessDateForInstant(tx, input.gymId, now);
      if (context.offboardingCase.fecha_efectiva.getTime() !== businessToday.getTime()) {
        throw new TrainerOffboardingCaseError(
          context.offboardingCase.fecha_efectiva.getTime() > businessToday.getTime()
            ? "La resolución solo puede aplicarse al llegar el día efectivo del gimnasio."
            : "La fecha efectiva pasó; reprograme el expediente antes de resolver.",
          409,
        );
      }
      const valuation = await this.valuation(tx, input.gymId, context);
      if (type === "REEMBOLSO_PENDIENTE" && valuation.unusedMinor === 0) {
        throw new TrainerOffboardingCaseError("La membresía no tiene valor reembolsable.");
      }
      const destinationPlanId = String(input.destinationPlanId ?? "").trim();
      const plan = type === "CAMBIO_PLAN"
        ? await tx.planesPago.findFirst({
            where: { id_planes_pago: destinationPlanId, gym_id: input.gymId, activo: true, is_deleted: false },
          })
        : null;
      if (type === "CAMBIO_PLAN" && !plan) throw new TrainerOffboardingCaseError("El plan de destino no está disponible.", 404);
      if (plan && plan.id_planes_pago === context.membership.id_planes_pago) throw new TrainerOffboardingCaseError("Elija un plan diferente al actual.");
      if (plan && plan.moneda_id !== context.membership.moneda_id) {
        throw new TrainerOffboardingCaseError("El cambio de plan debe conservar la moneda; la conversión requiere una operación cambiaria separada.");
      }
      const targetTrainerId = String(input.targetTrainerId ?? "").trim() || null;
      if (plan?.incluye_entrenador && !targetTrainerId) throw new TrainerOffboardingCaseError("Seleccione el entrenador que prestará el nuevo plan.");
      if (!plan?.incluye_entrenador && targetTrainerId) throw new TrainerOffboardingCaseError("El plan elegido no incluye entrenador; no debe asignarse uno.");
      if (targetTrainerId) {
        const trainer = await tx.entrenador.findFirst({
          where: { id_entrenador: targetTrainerId, gym_id: input.gymId, activo_entrenador: true, is_deleted: false },
        });
        if (!trainer || trainer.id_entrenador === context.offboardingCase.id_entrenador) {
          throw new TrainerOffboardingCaseError("El entrenador de destino no está disponible.", 404);
        }
      }
      const destination = calculateOffboardingFinancialDestination({
        type,
        unusedMinor: valuation.unusedMinor,
        destinationPriceMinor: plan ? this.toMinor(plan.importe_plan_pago) : null,
      });
      const operatorName = await this.identityName(tx, input.gymId, input.userId);
      const resolutionId = randomUUID();

      if (type === "REEMBOLSO_PENDIENTE") {
        const finance = await this.execution.moveFutureInstallments(tx, {
          gymId: input.gymId,
          offboardingCase: context.offboardingCase,
          decision: context.decision,
          targetTrainerId: null,
          userId: input.userId,
          operatorName,
          now,
        });
        await this.closeOrigin(tx, input.gymId, context, now);
        const row = await this.createResolution(tx, {
          id: resolutionId, operationId, context, type, state: destination.state,
          plan, targetTrainerId, valuation, destination, reason,
          userId: input.userId, operatorName, now, gymId: input.gymId,
          destinationMembershipId: null,
        });
        await this.recordSync(tx, RESOLUTION_ENTITY, "INSERT", input.gymId, row.ajuste_financiero_id, row, operationId);
        const decision = await tx.entrenadorBajaDecision.update({
          where: { decision_id: context.decision.decision_id },
          data: {
            estado_ejecucion: "ESPERA_TESORERIA",
            ejecutada_at: null,
            ejecucion_resultado_json: JSON.stringify(serialize({
              resolucion_financiera_id: resolutionId,
              tipo: type,
              importe_reembolso: this.money(destination.refundMinor),
              cuotas_anuladas: finance.cancelled,
              servicio_cerrado: true,
            })),
            version: { increment: 1 },
            updated_at: now,
          },
        });
        await this.recordSync(tx, "entrenador_baja_decision", "UPDATE", input.gymId, decision.decision_id, decision);
        await this.execution.refreshClientProjection(tx, input.gymId, context.membership.ci, now);
        return;
      }

      const finance = await this.execution.moveFutureInstallments(tx, {
        gymId: input.gymId,
        offboardingCase: context.offboardingCase,
        decision: context.decision,
        targetTrainerId: null,
        userId: input.userId,
        operatorName,
        now,
      });
      await this.closeOrigin(tx, input.gymId, context, now);
      const creditId = valuation.unusedMinor > 0 ? randomUUID() : null;
      let destinationMembership: any = null;
      if (plan) {
        const start = context.offboardingCase.fecha_efectiva;
        const end = this.addDays(start, plan.duracion_plan_pago);
        const active = destination.amountDueMinor === 0;
        destinationMembership = await tx.membresiaCliente.create({
          data: {
            membresia_id: randomUUID(), ci: context.membership.ci,
            id_planes_pago: plan.id_planes_pago, id_entrenador: targetTrainerId,
            plan_nombre_snapshot: plan.nombre_plan_pago?.trim() || plan.id_planes_pago,
            precio_snapshot: plan.importe_plan_pago, moneda_id: plan.moneda_id,
            duracion_dias_snapshot: plan.duracion_plan_pago,
            fecha_inicio: start, fecha_fin: end,
            estado: active ? "ACTIVA" : "PENDIENTE_PAGO", origen: "CAMBIO",
            importe_pagado: this.money(destination.creditAppliedMinor),
            activada_at: active ? now : null, reconstruida: false,
            confianza_reconstruccion: null, is_deleted: false, created_at: now,
            gym_id: input.gymId, source_device: "WEB_ADMIN", version: 1,
            updated_at: now, deleted_at: null,
          },
        });
        await this.recordSync(tx, "membresia_cliente", "INSERT", input.gymId, destinationMembership.membresia_id, destinationMembership);
        if (targetTrainerId) {
          const assignment = await tx.membresiaEntrenadorAsignacion.create({
            data: {
              asignacion_id: randomUUID(), membresia_id: destinationMembership.membresia_id,
              id_entrenador: targetTrainerId, fecha_inicio: start, fecha_fin: null,
              estado: active ? "ACTIVA" : "PENDIENTE", motivo_cierre: null,
              is_deleted: false, created_at: now, gym_id: input.gymId,
              source_device: "WEB_ADMIN", version: 1, updated_at: now, deleted_at: null,
            },
          });
          await this.recordSync(tx, "membresia_entrenador_asignacion", "INSERT", input.gymId, assignment.asignacion_id, assignment);
        }
      }
      if (creditId) {
        const balance = destination.remainingCreditMinor;
        const credit = await tx.clienteCredito.create({
          data: {
            credito_id: creditId, ajuste_financiero_id: resolutionId,
            ci: context.membership.ci, moneda_id: context.membership.moneda_id,
            monto_original: this.money(valuation.unusedMinor), saldo: this.money(balance),
            estado: balance === 0 ? "AGOTADO" : balance === valuation.unusedMinor ? "DISPONIBLE" : "PARCIAL",
            motivo: reason, generado_por_user_id: input.userId,
            generado_por_nombre_snapshot: operatorName, generado_at: now,
            is_deleted: false, created_at: now, gym_id: input.gymId,
            source_device: "WEB_ADMIN", version: 1, updated_at: now, deleted_at: null,
          },
        });
        await this.recordSync(tx, CREDIT_ENTITY, "INSERT", input.gymId, credit.credito_id, credit);
        if (destinationMembership && destination.creditAppliedMinor > 0) {
          const application = await tx.creditoMembresiaAplicacion.create({
            data: {
              aplicacion_id: randomUUID(), credito_id: creditId,
              membresia_id: destinationMembership.membresia_id,
              moneda_id: context.membership.moneda_id,
              monto_aplicado: this.money(destination.creditAppliedMinor), aplicada_at: now,
              is_deleted: false, created_at: now, gym_id: input.gymId,
              source_device: "WEB_ADMIN", version: 1, updated_at: now, deleted_at: null,
            },
          });
          await this.recordSync(tx, CREDIT_APPLICATION_ENTITY, "INSERT", input.gymId, application.aplicacion_id, application);
        }
      }
      if (plan && destinationMembership && destination.creditAppliedMinor > 0) {
        await this.payments.createTrainerCommissionAccrual(tx, {
          payment: {
            pago_cliente_id: creditId, fecha: now,
            monto_total: this.money(destination.creditAppliedMinor),
            moneda_id: plan.moneda_id,
          },
          plan, trainerId: targetTrainerId,
          serviceStart: destinationMembership.fecha_inicio,
          serviceEnd: destinationMembership.fecha_fin,
          gymId: input.gymId, occurredAt: now,
          membershipId: destinationMembership.membresia_id,
          sourceType: "CREDITO_MEMBRESIA", sourceId: creditId,
        });
      }
      const resolution = await this.createResolution(tx, {
        id: resolutionId, operationId, context, type, state: destination.state,
        plan, targetTrainerId, valuation, destination, reason,
        userId: input.userId, operatorName, now, gymId: input.gymId,
        destinationMembershipId: destinationMembership?.membresia_id ?? null,
      });
      await this.recordSync(tx, RESOLUTION_ENTITY, "INSERT", input.gymId, resolution.ajuste_financiero_id, resolution, operationId);
      const decision = await tx.entrenadorBajaDecision.update({
        where: { decision_id: context.decision.decision_id },
        data: {
          estado_ejecucion: "APLICADA", id_entrenador_destino: targetTrainerId,
          ejecutada_at: now,
          ejecucion_resultado_json: JSON.stringify(serialize({
            resolucion_financiera_id: resolutionId, tipo: type,
            membresia_destino_id: destinationMembership?.membresia_id ?? null,
            credito_aplicado: this.money(destination.creditAppliedMinor),
            saldo_credito: this.money(destination.remainingCreditMinor),
            importe_pendiente: this.money(destination.amountDueMinor),
            cuotas_anuladas: finance.cancelled,
          })),
          version: { increment: 1 }, updated_at: now,
        },
      });
      await this.recordSync(tx, "entrenador_baja_decision", "UPDATE", input.gymId, decision.decision_id, decision);
      await this.execution.refreshClientProjection(tx, input.gymId, context.membership.ci, now);
    });
    return this.cases.getById(input.gymId, input.trainerId, input.caseId);
  }

  private async loadContext(tx: any, input: { gymId: string; trainerId: string; caseId: string; membershipId: string }) {
    const offboardingCase = await tx.entrenadorBajaExpediente.findFirst({
      where: { expediente_id: input.caseId, id_entrenador: input.trainerId.trim(), gym_id: input.gymId, is_deleted: false },
    });
    if (!offboardingCase) throw new TrainerOffboardingCaseError("Expediente no encontrado.", 404);
    const decision = await tx.entrenadorBajaDecision.findFirst({
      where: { expediente_id: input.caseId, membresia_id: input.membershipId, gym_id: input.gymId, is_deleted: false },
    });
    if (!decision || decision.tipo !== "AJUSTAR_CANCELAR") {
      throw new TrainerOffboardingCaseError("La membresía no está marcada para cambio de plan o ajuste financiero.", 409);
    }
    const membership = await tx.membresiaCliente.findFirst({
      where: { membresia_id: input.membershipId, gym_id: input.gymId, is_deleted: false },
    });
    if (!membership) throw new TrainerOffboardingCaseError("Membresía no encontrada.", 404);
    const resolution = await tx.membresiaAjusteFinanciero.findFirst({
      where: { decision_id: decision.decision_id, gym_id: input.gymId, is_deleted: false },
    });
    return { offboardingCase, decision, membership, resolution };
  }

  private async valuation(tx: any, gymId: string, context: any) {
    const pause = context.membership.estado === "PAUSADA"
      ? await tx.membresiaPausa.findFirst({
          where: { membresia_id: context.membership.membresia_id, gym_id: gymId, estado: "ACTIVA", is_deleted: false },
          orderBy: { pausada_at: "desc" },
        })
      : null;
    return calculateUnusedMembershipValue({
      paidMinor: this.toMinor(context.membership.importe_pagado),
      durationDays: context.membership.duracion_dias_snapshot,
      start: context.membership.fecha_inicio, endExclusive: context.membership.fecha_fin,
      effectiveDate: context.offboardingCase.fecha_efectiva,
      membershipState: context.membership.estado,
      pausedRemainingDays: pause?.dias_restantes_snapshot ?? null,
    });
  }

  private async closeOrigin(tx: Tx, gymId: string, context: any, now: Date) {
    const assignments = await tx.membresiaEntrenadorAsignacion.findMany({
      where: { membresia_id: context.membership.membresia_id, gym_id: gymId, is_deleted: false, estado: { in: ["PENDIENTE", "ACTIVA"] } },
    });
    for (const row of assignments) {
      const updated = await tx.membresiaEntrenadorAsignacion.update({
        where: { asignacion_id: row.asignacion_id },
        data: {
          fecha_fin: context.offboardingCase.fecha_efectiva,
          estado: row.fecha_inicio.getTime() >= context.offboardingCase.fecha_efectiva.getTime() ? "CANCELADA" : "CERRADA",
          motivo_cierre: `AJUSTE_FINANCIERO_BAJA:${context.offboardingCase.expediente_id}`,
          version: { increment: 1 }, updated_at: now,
        },
      });
      await this.recordSync(tx, "membresia_entrenador_asignacion", "UPDATE", gymId, updated.asignacion_id, updated);
    }
    const pauses = await tx.membresiaPausa.findMany({
      where: { membresia_id: context.membership.membresia_id, gym_id: gymId, estado: "ACTIVA", is_deleted: false },
    });
    for (const row of pauses) {
      const updated = await tx.membresiaPausa.update({
        where: { pausa_id: row.pausa_id },
        data: {
          estado: "CANCELADA", activa_clave: null,
          fecha_reanudacion: context.offboardingCase.fecha_efectiva,
          reanudada_at: now, version: { increment: 1 }, updated_at: now,
        },
      });
      await this.recordSync(tx, "membresia_pausa", "UPDATE", gymId, updated.pausa_id, updated);
    }
    const membership = await tx.membresiaCliente.update({
      where: { membresia_id: context.membership.membresia_id },
      data: { fecha_fin: context.offboardingCase.fecha_efectiva, estado: "CANCELADA", version: { increment: 1 }, updated_at: now },
    });
    await this.recordSync(tx, "membresia_cliente", "UPDATE", gymId, membership.membresia_id, membership);
  }

  private createResolution(tx: Tx, input: any) {
    return tx.membresiaAjusteFinanciero.create({
      data: {
        ajuste_financiero_id: input.id, operacion_id: input.operationId,
        expediente_id: input.context.offboardingCase.expediente_id,
        decision_id: input.context.decision.decision_id,
        membresia_origen_id: input.context.membership.membresia_id,
        membresia_destino_id: input.destinationMembershipId,
        tipo: input.type, estado: input.state,
        plan_destino_id: input.plan?.id_planes_pago ?? null,
        id_entrenador_destino: input.targetTrainerId,
        moneda_id: input.context.membership.moneda_id,
        precio_origen: input.context.membership.precio_snapshot,
        importe_pagado_origen: input.context.membership.importe_pagado,
        valor_no_consumido: this.money(input.valuation.unusedMinor),
        precio_destino: input.plan?.importe_plan_pago ?? null,
        credito_aplicado: this.money(input.destination.creditAppliedMinor),
        importe_pendiente: this.money(input.destination.amountDueMinor),
        saldo_credito_generado: this.money(input.destination.remainingCreditMinor),
        importe_reembolso: this.money(input.destination.refundMinor),
        fecha_efectiva: input.context.offboardingCase.fecha_efectiva,
        motivo: input.reason,
        formula_snapshot_json: JSON.stringify(serialize(input.valuation)),
        registrada_por_user_id: input.userId,
        registrada_por_nombre_snapshot: input.operatorName,
        registrada_at: input.now, is_deleted: false, created_at: input.now,
        gym_id: input.gymId, source_device: "WEB_ADMIN", version: 1,
        updated_at: input.now, deleted_at: null,
      },
    });
  }

  private type(value: unknown, required: boolean) {
    const type = String(value ?? "").trim().toUpperCase();
    if (!type && !required) return null;
    if (!["CAMBIO_PLAN", "CREDITO_CLIENTE", "REEMBOLSO_PENDIENTE"].includes(type)) {
      throw new TrainerOffboardingCaseError("La resolución financiera no es válida.");
    }
    return type as OffboardingFinancialResolutionType;
  }

  private async identityName(tx: Tx, gymId: string, userId: string) {
    const user = await tx.user.findFirst({ where: { user_id: userId, gym_id: gymId, active: true, is_deleted: false } });
    if (!user) throw new TrainerOffboardingCaseError("La cuenta operadora no es válida.", 403);
    return user.user_nombre;
  }

  private toMinor(value: unknown) { return Math.round(Number(value ?? 0) * 100); }
  private money(minor: number) { return minor / 100; }
  private addDays(date: Date, days: number) {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
  }
  private presentValuation(value: ReturnType<typeof calculateUnusedMembershipValue>) {
    return {
      metodo: value.method, dias_totales: value.durationDays,
      dias_consumidos: value.consumedDays, dias_restantes: value.remainingDays,
      importe_pagado: this.money(value.paidMinor), valor_consumido: this.money(value.consumedMinor),
      valor_no_consumido: this.money(value.unusedMinor),
    };
  }
  private presentDestination(value: ReturnType<typeof calculateOffboardingFinancialDestination>) {
    return {
      credito_aplicado: this.money(value.creditAppliedMinor),
      importe_pendiente: this.money(value.amountDueMinor),
      saldo_credito: this.money(value.remainingCreditMinor),
      importe_reembolso: this.money(value.refundMinor), estado: value.state,
    };
  }
  private async recordSync(
    tx: Tx, entity: string, operation: "INSERT" | "UPDATE", gymId: string,
    entityId: string, row: unknown, eventId: string = randomUUID(),
  ) {
    await tx.syncLog.create({
      data: {
        event_id: eventId, entidad: entity, operacion: operation,
        entidad_id: entityId, gym_id: gymId,
        payload_json: JSON.stringify(serialize(row)),
      },
    });
  }
}

export function asTrainerOffboardingFinancialError(error: unknown) {
  if (error instanceof TrainerOffboardingCaseError) return error;
  if (error instanceof OffboardingFinancialPolicyError) return new TrainerOffboardingCaseError(error.message);
  return null;
}
