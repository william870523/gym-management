import type { Prisma } from "@prisma/client";
import { trustedClock } from "../../config/trusted-clock";
import {
  assignmentStateForMembership,
  assertOffboardingExecutionReady,
  isTransferableFutureInstallment,
  splitCommissionInstallmentAtDate,
  type TrainerOffboardingDecisionType,
} from "../../domain/trainer-offboarding-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { CompensationProfileService } from "../accounting/compensation-profile.service";
import { FixedObligationService } from "../accounting/fixed-obligation.service";
import {
  TrainerOffboardingCaseError,
  TrainerOffboardingCaseService,
} from "./trainer-offboarding-case.service";

type Tx = Prisma.TransactionClient;
const CASE_ENTITY = "entrenador_baja_expediente";
const DECISION_ENTITY = "entrenador_baja_decision";
const ADJUSTMENT_ENTITY = "entrenador_baja_comision_ajuste";

type ExecutionSummary = {
  membresias_aplicadas: number;
  asignaciones_cerradas: number;
  asignaciones_creadas: number;
  cuotas_transferidas: number;
  cuotas_anuladas: number;
  perfiles_finalizados: number;
  entrenador_desactivado: boolean;
  siguiente_paso: string;
};

export class TrainerOffboardingExecutionService {
  private readonly cases = new TrainerOffboardingCaseService();
  private readonly profiles = new CompensationProfileService();
  private readonly fixedObligations = new FixedObligationService();

  businessDateForInstant(tx: Tx, gymId: string, instant: Date) {
    return this.profiles.businessDateForInstant(tx, gymId, instant);
  }

  async execute(input: {
    gymId: string;
    trainerId: string;
    caseId: string;
    operationId: string;
    userId: string;
  }) {
    const trainerId = input.trainerId.trim();
    const operationId = input.operationId.trim();
    if (operationId.length < 8) {
      throw new TrainerOffboardingCaseError("La operación de ejecución no es válida.");
    }
    const repeated = await prisma.entrenadorBajaExpediente.findFirst({
      where: { ejecucion_operacion_id: operationId, gym_id: input.gymId },
      select: { expediente_id: true, id_entrenador: true },
    });
    if (repeated) {
      if (repeated.expediente_id !== input.caseId || repeated.id_entrenador !== trainerId) {
        throw new TrainerOffboardingCaseError(
          "El identificador de operación ya fue usado en otro expediente.",
          409,
        );
      }
      return this.cases.getById(input.gymId, trainerId, input.caseId);
    }

    const now = trustedClock.nowUtc();
    const businessToday = await this.profiles.businessDateForInstant(
      prisma as any,
      input.gymId,
      now,
    );
    const preview = await prisma.entrenadorBajaExpediente.findFirst({
      where: {
        expediente_id: input.caseId,
        id_entrenador: trainerId,
        gym_id: input.gymId,
        is_deleted: false,
      },
    });
    if (!preview) {
      throw new TrainerOffboardingCaseError("Expediente abierto no encontrado.", 404);
    }
    const previewDecisions = await prisma.entrenadorBajaDecision.findMany({
      where: {
        expediente_id: preview.expediente_id,
        gym_id: input.gymId,
        is_deleted: false,
      },
      select: { tipo: true, estado_ejecucion: true },
    });
    assertOffboardingExecutionReady({
      state: preview.estado,
      effectiveDate: preview.fecha_efectiva,
      businessToday,
      decisions: previewDecisions
        .filter((row) => row.estado_ejecucion !== "APLICADA")
        .map(
        (row) => row.tipo as TrainerOffboardingDecisionType,
      ),
    });
    await this.fixedObligations.materializeDue(
      input.gymId,
      preview.fecha_efectiva.toISOString().slice(0, 10),
    );

    await prisma.$transaction(async (tx) => {
      const offboardingCase = await tx.entrenadorBajaExpediente.findFirst({
        where: {
          expediente_id: input.caseId,
          id_entrenador: trainerId,
          gym_id: input.gymId,
          abierto_clave: `${input.gymId}:${trainerId}`,
          is_deleted: false,
        },
      });
      if (!offboardingCase) {
        throw new TrainerOffboardingCaseError("Expediente abierto no encontrado.", 404);
      }
      if (offboardingCase.ejecucion_operacion_id) {
        if (offboardingCase.ejecucion_operacion_id === operationId) return;
        throw new TrainerOffboardingCaseError("El expediente ya fue aplicado.", 409);
      }
      const decisions = await tx.entrenadorBajaDecision.findMany({
        where: {
          expediente_id: offboardingCase.expediente_id,
          gym_id: input.gymId,
          is_deleted: false,
        },
        orderBy: { decision_id: "asc" },
      });
      assertOffboardingExecutionReady({
        state: offboardingCase.estado,
        effectiveDate: offboardingCase.fecha_efectiva,
        businessToday,
        decisions: decisions
          .filter((row) => row.estado_ejecucion !== "APLICADA")
          .map((row) => row.tipo as TrainerOffboardingDecisionType),
      });
      if (decisions.length !== offboardingCase.decisiones_total) {
        throw new TrainerOffboardingCaseError(
          "El expediente cambió desde su preparación. Vuelva a revisarlo.",
          409,
        );
      }
      const trainer = await tx.entrenador.findFirst({
        where: {
          id_entrenador: trainerId,
          gym_id: input.gymId,
          activo_entrenador: true,
          is_deleted: false,
        },
      });
      if (!trainer) {
        throw new TrainerOffboardingCaseError(
          "El entrenador ya no está activo; revise el expediente antes de continuar.",
          409,
        );
      }
      const operatorName = await this.identityName(tx, input.gymId, input.userId);
      const claimed = await tx.entrenadorBajaExpediente.updateMany({
        where: {
          expediente_id: offboardingCase.expediente_id,
          estado: "LISTO_PARA_REVISION",
          ejecucion_operacion_id: null,
        },
        data: {
          estado: "EN_EJECUCION",
          ejecucion_operacion_id: operationId,
          ejecutado_por_user_id: input.userId,
          ejecutado_por_nombre_snapshot: operatorName,
          ejecutado_at: now,
          updated_at: now,
        },
      });
      if (claimed.count !== 1) {
        throw new TrainerOffboardingCaseError(
          "Otra operación modificó el expediente. Actualice antes de reintentar.",
          409,
        );
      }

      const summary: ExecutionSummary = {
        membresias_aplicadas: 0,
        asignaciones_cerradas: 0,
        asignaciones_creadas: 0,
        cuotas_transferidas: 0,
        cuotas_anuladas: 0,
        perfiles_finalizados: 0,
        entrenador_desactivado: false,
        siguiente_paso: "LIQUIDACION_FINAL",
      };
      const affectedClients = new Set<string>();
      for (const decision of decisions.filter((row) => row.estado_ejecucion !== "APLICADA")) {
        const ci = await this.applyDecision(tx, {
          gymId: input.gymId,
          offboardingCase,
          decision,
          userId: input.userId,
          operatorName,
          now,
          summary,
        });
        affectedClients.add(ci);
      }
      for (const ci of affectedClients) {
        await this.refreshClientProjection(tx, input.gymId, ci, now);
      }
      summary.perfiles_finalizados = await this.finishProfiles(
        tx,
        input.gymId,
        trainerId,
        offboardingCase.fecha_efectiva,
        now,
      );
      const deactivated = await tx.entrenador.update({
        where: { id_entrenador: trainerId },
        data: {
          activo_entrenador: false,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      summary.entrenador_desactivado = true;
      await this.recordSync(
        tx,
        "entrenador",
        "UPDATE",
        input.gymId,
        deactivated.id_entrenador,
        deactivated,
      );

      const updatedCase = await tx.entrenadorBajaExpediente.update({
        where: { expediente_id: offboardingCase.expediente_id },
        data: {
          estado: "EN_EJECUCION",
          ejecucion_resumen_json: JSON.stringify(serialize(summary)),
          version: { increment: 1 },
          updated_at: now,
        },
      });
      await this.recordSync(
        tx,
        CASE_ENTITY,
        "UPDATE",
        input.gymId,
        updatedCase.expediente_id,
        updatedCase,
        operationId,
      );
    });
    return this.cases.getById(input.gymId, trainerId, input.caseId);
  }

  private async applyDecision(
    tx: Tx,
    input: {
      gymId: string;
      offboardingCase: any;
      decision: any;
      userId: string;
      operatorName: string;
      now: Date;
      summary: ExecutionSummary;
    },
  ) {
    const { offboardingCase, decision, now, summary } = input;
    const membership = await tx.membresiaCliente.findFirst({
      where: {
        membresia_id: decision.membresia_id,
        gym_id: input.gymId,
        is_deleted: false,
      },
    });
    if (!membership || membership.fecha_fin.getTime() <= offboardingCase.fecha_efectiva.getTime()) {
      throw new TrainerOffboardingCaseError(
        `La membresía de ${decision.socio_nombre_snapshot} venció o ya no existe. Revise el expediente.`,
        409,
      );
    }
    const newAssignmentState = assignmentStateForMembership(membership.estado);
    const openAssignments = await tx.membresiaEntrenadorAsignacion.findMany({
      where: {
        membresia_id: membership.membresia_id,
        gym_id: input.gymId,
        is_deleted: false,
        estado: { in: ["PENDIENTE", "ACTIVA"] },
      },
    });
    if (openAssignments.some((row) => row.id_entrenador !== offboardingCase.id_entrenador)) {
      throw new TrainerOffboardingCaseError(
        `La asignación de ${decision.socio_nombre_snapshot} cambió después de preparar el expediente.`,
        409,
      );
    }
    if (
      membership.id_entrenador !== offboardingCase.id_entrenador &&
      openAssignments.length === 0
    ) {
      throw new TrainerOffboardingCaseError(
        `La membresía de ${decision.socio_nombre_snapshot} ya no pertenece al entrenador saliente.`,
        409,
      );
    }

    let targetTrainerId: string | null = null;
    if (decision.tipo === "REASIGNAR") {
      targetTrainerId = decision.id_entrenador_destino;
      const target = targetTrainerId
        ? await tx.entrenador.findFirst({
            where: {
              id_entrenador: targetTrainerId,
              gym_id: input.gymId,
              activo_entrenador: true,
              is_deleted: false,
            },
          })
        : null;
      if (!target) {
        throw new TrainerOffboardingCaseError(
          `El entrenador elegido para ${decision.socio_nombre_snapshot} ya no está disponible.`,
          409,
        );
      }
    }

    for (const assignment of openAssignments) {
      const closed = await tx.membresiaEntrenadorAsignacion.update({
        where: { asignacion_id: assignment.asignacion_id },
        data: {
          fecha_fin: offboardingCase.fecha_efectiva,
          estado: assignment.fecha_inicio.getTime() >= offboardingCase.fecha_efectiva.getTime()
            ? "CANCELADA"
            : "CERRADA",
          motivo_cierre: `BAJA_ENTRENADOR:${offboardingCase.expediente_id}`,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      summary.asignaciones_cerradas++;
      await this.recordSync(
        tx,
        "membresia_entrenador_asignacion",
        "UPDATE",
        input.gymId,
        closed.asignacion_id,
        closed,
      );
    }

    let destinationAssignmentId: string | null = null;
    if (targetTrainerId) {
      const created = await tx.membresiaEntrenadorAsignacion.create({
        data: {
          asignacion_id: crypto.randomUUID(),
          membresia_id: membership.membresia_id,
          id_entrenador: targetTrainerId,
          fecha_inicio: offboardingCase.fecha_efectiva,
          fecha_fin: null,
          estado: newAssignmentState,
          motivo_cierre: null,
          is_deleted: false,
          created_at: now,
          gym_id: input.gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      destinationAssignmentId = created.asignacion_id;
      summary.asignaciones_creadas++;
      await this.recordSync(
        tx,
        "membresia_entrenador_asignacion",
        "INSERT",
        input.gymId,
        created.asignacion_id,
        created,
      );
    }

    const updatedMembership = await tx.membresiaCliente.update({
      where: { membresia_id: membership.membresia_id },
      data: {
        id_entrenador: targetTrainerId,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    await this.recordSync(
      tx,
      "membresia_cliente",
      "UPDATE",
      input.gymId,
      updatedMembership.membresia_id,
      updatedMembership,
    );
    const finance = await this.moveFutureInstallments(tx, {
      gymId: input.gymId,
      offboardingCase,
      decision,
      targetTrainerId,
      userId: input.userId,
      operatorName: input.operatorName,
      now,
    });
    summary.cuotas_transferidas += finance.transferred;
    summary.cuotas_anuladas += finance.cancelled;
    summary.membresias_aplicadas++;

    const result = {
      plan_conservado: membership.plan_nombre_snapshot,
      entrenador_destino: targetTrainerId,
      asignacion_destino_id: destinationAssignmentId,
      cuotas_transferidas: finance.transferred,
      cuotas_anuladas: finance.cancelled,
    };
    const updatedDecision = await tx.entrenadorBajaDecision.update({
      where: { decision_id: decision.decision_id },
      data: {
        estado_ejecucion: "APLICADA",
        asignacion_destino_id: destinationAssignmentId,
        ejecutada_at: now,
        ejecucion_resultado_json: JSON.stringify(serialize(result)),
        version: { increment: 1 },
        updated_at: now,
      },
    });
    await this.recordSync(
      tx,
      DECISION_ENTITY,
      "UPDATE",
      input.gymId,
      updatedDecision.decision_id,
      updatedDecision,
    );
    return membership.ci;
  }

  async moveFutureInstallments(
    tx: Tx,
    input: {
      gymId: string;
      offboardingCase: any;
      decision: any;
      targetTrainerId: string | null;
      userId: string;
      operatorName: string;
      now: Date;
    },
  ) {
    const applications = await tx.pagoMembresiaAplicacion.findMany({
      where: {
        membresia_id: input.decision.membresia_id,
        gym_id: input.gymId,
        is_deleted: false,
      },
      select: { pago_cliente_id: true },
    });
    const paymentIds = applications.map((row) => row.pago_cliente_id);
    const accruals = await tx.entrenadorComisionDevengo.findMany({
      where: {
        OR: [
          { membresia_id: input.decision.membresia_id },
          ...(paymentIds.length ? [{ pago_cliente_id: { in: paymentIds } }] : []),
        ],
        id_entrenador: input.offboardingCase.id_entrenador,
        gym_id: input.gymId,
        is_deleted: false,
        estado: { not: "ANULADO" },
      },
      select: { devengo_id: true, metodo_devengo: true },
    });
    if (!accruals.length) return { transferred: 0, cancelled: 0 };
    const installments = await tx.entrenadorComisionCuota.findMany({
      where: {
        devengo_id: { in: accruals.map((row) => row.devengo_id) },
        id_entrenador: input.offboardingCase.id_entrenador,
        gym_id: input.gymId,
        is_deleted: false,
        estado: { not: "ANULADO" },
        periodo_fin: { gt: input.offboardingCase.fecha_efectiva },
      },
      orderBy: [{ periodo_inicio: "asc" }, { cuota_id: "asc" }],
    });
    const methodByAccrual = new Map(
      accruals.map((row) => [row.devengo_id, row.metodo_devengo]),
    );
    const actionable = installments.filter((installment) =>
      installment.periodo_inicio.getTime() >= input.offboardingCase.fecha_efectiva.getTime()
      || methodByAccrual.get(installment.devengo_id) === "DIAS_SERVICIO"
    );
    for (const installment of actionable) {
      const fullyFuture = installment.periodo_inicio.getTime()
        >= input.offboardingCase.fecha_efectiva.getTime();
      if (installment.estado !== "PENDIENTE" || (
        fullyFuture && !isTransferableFutureInstallment({
          periodStart: installment.periodo_inicio,
          effectiveDate: input.offboardingCase.fecha_efectiva,
          state: installment.estado,
        })
      )) {
        throw new TrainerOffboardingCaseError(
          "Existe una cuota futura pagada o parcial. Requiere un ajuste financiero manual antes de ejecutar.",
          409,
        );
      }
    }
    let transferred = 0;
    let cancelled = 0;
    const touchedAccruals = new Set<string>();
    for (const installment of actionable) {
      const type = input.targetTrainerId ? "TRANSFERIR" : "ANULAR";
      const splitCurrentPeriod = installment.periodo_inicio.getTime()
        < input.offboardingCase.fecha_efectiva.getTime();
      let adjustmentAmount = installment.monto;
      let adjustmentStart = installment.periodo_inicio;
      let destinationInstallmentId: string | null = null;
      let updated;
      if (splitCurrentPeriod) {
        const split = splitCommissionInstallmentAtDate({
          amountMinor: Math.round(installment.monto * 100),
          periodStart: installment.periodo_inicio,
          periodEnd: installment.periodo_fin,
          effectiveDate: input.offboardingCase.fecha_efectiva,
        });
        adjustmentAmount = split.futureMinor / 100;
        adjustmentStart = input.offboardingCase.fecha_efectiva;
        updated = await tx.entrenadorComisionCuota.update({
          where: { cuota_id: installment.cuota_id },
          data: {
            monto: split.earnedMinor / 100,
            periodo_fin: input.offboardingCase.fecha_efectiva,
            estado: split.earnedMinor === 0 ? "ANULADO" : "PENDIENTE",
            notas: `Prorrateada por baja ${input.offboardingCase.expediente_id}`,
            version: { increment: 1 },
            updated_at: input.now,
          },
        });
        if (input.targetTrainerId && split.futureMinor > 0) {
          const destination = await tx.entrenadorComisionCuota.create({
            data: {
              cuota_id: crypto.randomUUID(),
              devengo_id: installment.devengo_id,
              id_entrenador: input.targetTrainerId,
              moneda_id: installment.moneda_id,
              periodo_inicio: input.offboardingCase.fecha_efectiva,
              periodo_fin: installment.periodo_fin,
              fecha_programada: installment.fecha_programada,
              monto: split.futureMinor / 100,
              estado: "PENDIENTE",
              fecha_pago: null,
              cuenta_id: null,
              notas: `Tramo transferido por baja ${input.offboardingCase.expediente_id}`,
              is_deleted: false,
              created_at: input.now,
              gym_id: input.gymId,
              source_device: "WEB_ADMIN",
              version: 1,
              updated_at: input.now,
              deleted_at: null,
            },
          });
          destinationInstallmentId = destination.cuota_id;
          await this.recordSync(
            tx,
            "entrenador_comision_cuota",
            "INSERT",
            input.gymId,
            destination.cuota_id,
            destination,
          );
          const accrual = await tx.entrenadorComisionDevengo.update({
            where: { devengo_id: installment.devengo_id },
            data: {
              cuotas_total: { increment: 1 },
              version: { increment: 1 },
              updated_at: input.now,
            },
          });
          await this.recordSync(
            tx,
            "entrenador_comision_devengo",
            "UPDATE",
            input.gymId,
            accrual.devengo_id,
            accrual,
          );
        }
      } else {
        updated = await tx.entrenadorComisionCuota.update({
          where: { cuota_id: installment.cuota_id },
          data: input.targetTrainerId
            ? {
                id_entrenador: input.targetTrainerId,
                notas: `Transferida por baja ${input.offboardingCase.expediente_id}`,
                version: { increment: 1 },
                updated_at: input.now,
              }
            : {
                estado: "ANULADO",
                notas: `Anulada por continuidad sin entrenador ${input.offboardingCase.expediente_id}`,
                version: { increment: 1 },
                updated_at: input.now,
              },
        });
      }
      await this.recordSync(
        tx,
        "entrenador_comision_cuota",
        "UPDATE",
        input.gymId,
        updated.cuota_id,
        updated,
      );
      const adjustment = await tx.entrenadorBajaComisionAjuste.create({
        data: {
          ajuste_id: crypto.randomUUID(),
          expediente_id: input.offboardingCase.expediente_id,
          decision_id: input.decision.decision_id,
          membresia_id: input.decision.membresia_id,
          devengo_id: installment.devengo_id,
          cuota_id: installment.cuota_id,
          tipo: type,
          id_entrenador_origen: input.offboardingCase.id_entrenador,
          id_entrenador_destino: input.targetTrainerId,
          moneda_id: installment.moneda_id,
          monto: adjustmentAmount,
          periodo_inicio: adjustmentStart,
          periodo_fin: installment.periodo_fin,
          estado_anterior: installment.estado,
          estado_resultante: input.targetTrainerId ? "TRANSFERIDA" : "ANULADA",
          registrado_por_user_id: input.userId,
          registrado_por_nombre_snapshot: input.operatorName,
          registrado_at: input.now,
          resumen_json: JSON.stringify(serialize({
            plan_conservado: input.decision.plan_nombre_snapshot,
            motivo: input.decision.motivo,
            cuota_destino_id: destinationInstallmentId,
            prorrateo_dias_servicio: splitCurrentPeriod,
          })),
          is_deleted: false,
          created_at: input.now,
          gym_id: input.gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: input.now,
          deleted_at: null,
        },
      });
      await this.recordSync(
        tx,
        ADJUSTMENT_ENTITY,
        "INSERT",
        input.gymId,
        adjustment.ajuste_id,
        adjustment,
      );
      if (input.targetTrainerId) transferred++;
      else cancelled++;
      touchedAccruals.add(installment.devengo_id);
    }
    for (const accrualId of touchedAccruals) {
      const remaining = await tx.entrenadorComisionCuota.count({
        where: {
          devengo_id: accrualId,
          estado: { not: "ANULADO" },
          is_deleted: false,
        },
      });
      if (remaining === 0) {
        const annulled = await tx.entrenadorComisionDevengo.update({
          where: { devengo_id: accrualId },
          data: {
            estado: "ANULADO",
            version: { increment: 1 },
            updated_at: input.now,
          },
        });
        await this.recordSync(
          tx,
          "entrenador_comision_devengo",
          "UPDATE",
          input.gymId,
          annulled.devengo_id,
          annulled,
        );
      }
    }
    return { transferred, cancelled };
  }

  async refreshClientProjection(tx: Tx, gymId: string, ci: string, now: Date) {
    const current = await tx.membresiaCliente.findFirst({
      where: {
        ci,
        gym_id: gymId,
        is_deleted: false,
        estado: { in: ["PENDIENTE_PAGO", "ACTIVA", "PAUSADA"] },
      },
      orderBy: [{ fecha_fin: "desc" }, { updated_at: "desc" }],
    });
    const client = await tx.cliente.findFirst({
      where: { ci, gym_id: gymId, is_deleted: false },
    });
    if (!client) return;
    const updated = await tx.cliente.update({
      where: { ci },
      data: {
        id_planes_pago: current?.id_planes_pago ?? client.id_planes_pago,
        id_entrenador: current?.id_entrenador ?? null,
        fecha_inicio: current?.fecha_inicio ?? client.fecha_inicio,
        fecha_fin: current?.fecha_fin ?? client.fecha_fin,
        activo: current?.estado === "ACTIVA" || current?.estado === "PAUSADA",
        version: { increment: 1 },
        updated_at: now,
      },
    });
    const nationality = await tx.nacionalidad.findUnique({
      where: { nacionalidad_id: updated.nacionalidad_id },
      select: { codigo_iso: true },
    });
    if (!nationality) {
      throw new TrainerOffboardingCaseError(
        `No se pudo resolver la nacionalidad del socio ${ci}.`,
        409,
      );
    }
    await this.recordSync(tx, "cliente", "UPDATE", gymId, updated.ci, {
      ...updated,
      nacionalidad_codigo_iso: nationality.codigo_iso,
    });
  }

  private async finishProfiles(
    tx: Tx,
    gymId: string,
    trainerId: string,
    effectiveDate: Date,
    now: Date,
  ) {
    const profiles = await tx.entrenadorCompensacionPerfil.findMany({
      where: {
        gym_id: gymId,
        id_entrenador: trainerId,
        activo: true,
        is_deleted: false,
        OR: [{ fecha_fin: null }, { fecha_fin: { gt: effectiveDate } }],
      },
    });
    for (const profile of profiles) {
      const scheduled = profile.fecha_inicio.getTime() >= effectiveDate.getTime();
      const updated = await tx.entrenadorCompensacionPerfil.update({
        where: { perfil_id: profile.perfil_id },
        data: scheduled
          ? {
              activo: false,
              is_deleted: true,
              deleted_at: now,
              version: { increment: 1 },
              updated_at: now,
            }
          : {
              activo: false,
              fecha_fin: effectiveDate,
              version: { increment: 1 },
              updated_at: now,
            },
      });
      await this.recordSync(
        tx,
        "entrenador_compensacion_perfil",
        "UPDATE",
        gymId,
        updated.perfil_id,
        updated,
      );
    }
    return profiles.length;
  }

  private async identityName(tx: Tx, gymId: string, userId: string) {
    const user = await tx.user.findFirst({
      where: {
        user_id: userId,
        gym_id: gymId,
        active: true,
        is_deleted: false,
      },
    });
    if (!user) {
      throw new TrainerOffboardingCaseError("La cuenta operadora no es válida.", 403);
    }
    return user.user_nombre;
  }

  private async recordSync(
    tx: Tx,
    entity: string,
    operation: "INSERT" | "UPDATE",
    gymId: string,
    entityId: string,
    row: unknown,
    eventId: string = crypto.randomUUID(),
  ) {
    await tx.syncLog.create({
      data: {
        event_id: eventId,
        entidad: entity,
        operacion: operation,
        entidad_id: entityId,
        gym_id: gymId,
        device_id: "WEB_ADMIN",
        payload_json: JSON.stringify(serialize(row)),
      },
    });
  }
}
