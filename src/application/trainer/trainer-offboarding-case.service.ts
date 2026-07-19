import type { Prisma } from "@prisma/client";
import { trustedClock } from "../../config/trusted-clock";
import {
  deriveOffboardingDraftState,
  normalizeOffboardingDecision,
  normalizeOffboardingEffectiveDate,
  normalizeOffboardingReason,
  TrainerOffboardingPolicyError,
  type TrainerOffboardingDecisionType,
} from "../../domain/trainer-offboarding-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { TrainerOffboardingService } from "./trainer-offboarding.service";

const CASE_ENTITY = "entrenador_baja_expediente";
const DECISION_ENTITY = "entrenador_baja_decision";
type Tx = Prisma.TransactionClient;

export class TrainerOffboardingCaseError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "TrainerOffboardingCaseError";
  }
}

export class TrainerOffboardingCaseService {
  private readonly impactService = new TrainerOffboardingService();

  async getOpen(gymId: string, trainerId: string) {
    const row = await prisma.entrenadorBajaExpediente.findFirst({
      where: {
        gym_id: gymId,
        id_entrenador: trainerId.trim(),
        abierto_clave: this.openKey(gymId, trainerId),
        is_deleted: false,
      },
    });
    return row ? this.present(gymId, row.expediente_id) : null;
  }

  async create(input: {
    gymId: string;
    trainerId: string;
    effectiveDate?: unknown;
    reason: unknown;
    userId: string;
  }) {
    const trainerId = input.trainerId.trim();
    const existing = await this.getOpen(input.gymId, trainerId);
    if (existing) return { ...existing, idempotent: true };

    const impact = await this.impactService.impact(input.gymId, trainerId);
    const businessToday = new Date(`${impact.business_date}T00:00:00.000Z`);
    const effectiveDate = normalizeOffboardingEffectiveDate(
      input.effectiveDate ?? impact.business_date,
      businessToday,
    );
    const reason = normalizeOffboardingReason(input.reason);
    const now = trustedClock.nowUtc();
    const expedienteId = crypto.randomUUID();
    const openKey = this.openKey(input.gymId, trainerId);
    const initial = deriveOffboardingDraftState(
      impact.membresias.map(() => "PENDIENTE" as const),
    );

    await prisma.$transaction(async (tx) => {
      const duplicate = await tx.entrenadorBajaExpediente.findUnique({
        where: { abierto_clave: openKey },
      });
      if (duplicate) return;
      const operatorName = await this.identityName(tx, input.gymId, input.userId);
      const created = await tx.entrenadorBajaExpediente.create({
        data: {
          expediente_id: expedienteId,
          id_entrenador: trainerId,
          abierto_clave: openKey,
          fecha_efectiva: effectiveDate,
          estado: initial.state,
          motivo: reason,
          decisiones_total: impact.membresias.length,
          decisiones_pendientes: initial.pending,
          creado_por_user_id: input.userId,
          creado_por_nombre_snapshot: operatorName,
          creado_at: now,
          impacto_snapshot_json: JSON.stringify(serialize(impact)),
          is_deleted: false,
          created_at: now,
          gym_id: input.gymId,
          source_device: "WEB_ADMIN",
          version: 1,
          updated_at: now,
          deleted_at: null,
        },
      });
      await this.recordSync(tx, CASE_ENTITY, "INSERT", input.gymId, created.expediente_id, created);

      for (const membership of impact.membresias) {
        const decision = await tx.entrenadorBajaDecision.create({
          data: {
            decision_id: crypto.randomUUID(),
            expediente_id: created.expediente_id,
            membresia_id: membership.membresia_id,
            asignacion_origen_id: membership.asignacion_id,
            tipo: "PENDIENTE",
            id_entrenador_destino: null,
            motivo: null,
            socio_ci_snapshot: membership.ci,
            socio_nombre_snapshot: membership.socio_nombre,
            plan_nombre_snapshot: membership.plan_nombre,
            membresia_estado_snapshot: membership.estado,
            membresia_fecha_inicio_snapshot: membership.fecha_inicio,
            membresia_fecha_fin_snapshot: membership.fecha_fin,
            origen_asignacion_snapshot: membership.origen_asignacion,
            decidida_por_user_id: null,
            decidida_por_nombre_snapshot: null,
            decidida_at: null,
            is_deleted: false,
            created_at: now,
            gym_id: input.gymId,
            source_device: "WEB_ADMIN",
            version: 1,
            updated_at: now,
            deleted_at: null,
          },
        });
        await this.recordSync(
          tx,
          DECISION_ENTITY,
          "INSERT",
          input.gymId,
          decision.decision_id,
          decision,
        );
      }
    });

    const result = await this.getOpen(input.gymId, trainerId);
    if (!result) {
      throw new TrainerOffboardingCaseError(
        "No se pudo recuperar el expediente después de crearlo.",
        409,
      );
    }
    return { ...result, idempotent: result.expediente_id !== expedienteId };
  }

  async updateDecision(input: {
    gymId: string;
    trainerId: string;
    caseId: string;
    membershipId: string;
    operationId: string;
    userId: string;
    decision: Record<string, unknown>;
  }) {
    const operationId = input.operationId.trim();
    if (operationId.length < 8) {
      throw new TrainerOffboardingCaseError("La operación de decisión no es válida.");
    }
    const duplicate = await prisma.syncLog.findUnique({
      where: { event_id: operationId },
    });
    if (duplicate) return this.getById(input.gymId, input.trainerId, input.caseId);

    const now = trustedClock.nowUtc();
    await prisma.$transaction(async (tx) => {
      const expediente = await tx.entrenadorBajaExpediente.findFirst({
        where: {
          expediente_id: input.caseId,
          id_entrenador: input.trainerId.trim(),
          gym_id: input.gymId,
          abierto_clave: this.openKey(input.gymId, input.trainerId),
          is_deleted: false,
          estado: { in: ["BORRADOR", "LISTO_PARA_REVISION"] },
        },
      });
      if (!expediente) {
        throw new TrainerOffboardingCaseError(
          "El expediente no existe o ya no admite cambios.",
          404,
        );
      }
      const current = await tx.entrenadorBajaDecision.findFirst({
        where: {
          expediente_id: expediente.expediente_id,
          membresia_id: input.membershipId,
          gym_id: input.gymId,
          is_deleted: false,
        },
      });
      if (!current) {
        throw new TrainerOffboardingCaseError(
          "La membresía no forma parte de este expediente.",
          404,
        );
      }
      const normalized = normalizeOffboardingDecision(
        input.decision,
        expediente.id_entrenador,
      );
      if (normalized.targetTrainerId) {
        const target = await tx.entrenador.findFirst({
          where: {
            id_entrenador: normalized.targetTrainerId,
            gym_id: input.gymId,
            activo_entrenador: true,
            is_deleted: false,
          },
        });
        if (!target) {
          throw new TrainerOffboardingCaseError(
            "El entrenador de destino no existe o está inactivo.",
            404,
          );
        }
      }
      const operatorName = await this.identityName(tx, input.gymId, input.userId);
      const updated = await tx.entrenadorBajaDecision.update({
        where: { decision_id: current.decision_id },
        data: {
          tipo: normalized.type,
          id_entrenador_destino: normalized.targetTrainerId,
          motivo: normalized.reason,
          decidida_por_user_id: input.userId,
          decidida_por_nombre_snapshot: operatorName,
          decidida_at: now,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      const decisions = await tx.entrenadorBajaDecision.findMany({
        where: {
          expediente_id: expediente.expediente_id,
          gym_id: input.gymId,
          is_deleted: false,
        },
        select: { tipo: true },
      });
      const draft = deriveOffboardingDraftState(
        decisions.map((row) => row.tipo as TrainerOffboardingDecisionType),
      );
      const caseUpdated = await tx.entrenadorBajaExpediente.update({
        where: { expediente_id: expediente.expediente_id },
        data: {
          estado: draft.state,
          decisiones_pendientes: draft.pending,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      await this.recordSync(
        tx,
        DECISION_ENTITY,
        "UPDATE",
        input.gymId,
        updated.decision_id,
        updated,
        operationId,
      );
      await this.recordSync(
        tx,
        CASE_ENTITY,
        "UPDATE",
        input.gymId,
        caseUpdated.expediente_id,
        caseUpdated,
      );
    });
    return this.getById(input.gymId, input.trainerId, input.caseId);
  }

  async getById(gymId: string, trainerId: string, caseId: string) {
    const row = await prisma.entrenadorBajaExpediente.findFirst({
      where: {
        expediente_id: caseId,
        id_entrenador: trainerId.trim(),
        gym_id: gymId,
        is_deleted: false,
      },
    });
    if (!row) throw new TrainerOffboardingCaseError("Expediente no encontrado.", 404);
    return this.present(gymId, row.expediente_id);
  }

  private async present(gymId: string, caseId: string) {
    const [expediente, decisions, resolutions] = await Promise.all([
      prisma.entrenadorBajaExpediente.findFirst({
        where: { expediente_id: caseId, gym_id: gymId, is_deleted: false },
      }),
      prisma.entrenadorBajaDecision.findMany({
        where: { expediente_id: caseId, gym_id: gymId, is_deleted: false },
        orderBy: [{ membresia_fecha_fin_snapshot: "asc" }, { decision_id: "asc" }],
      }),
      prisma.membresiaAjusteFinanciero.findMany({
        where: { expediente_id: caseId, gym_id: gymId, is_deleted: false },
      }),
    ]);
    if (!expediente) throw new TrainerOffboardingCaseError("Expediente no encontrado.", 404);
    const targetIds = decisions
      .map((row) => row.id_entrenador_destino)
      .filter((id): id is string => Boolean(id));
    const targets = targetIds.length
      ? await prisma.entrenador.findMany({
          where: { gym_id: gymId, id_entrenador: { in: targetIds } },
        })
      : [];
    const targetMap = new Map(targets.map((row) => [
      row.id_entrenador,
      `${row.nombres_entrenador} ${row.apellidos_entrenador}`.trim(),
    ]));
    const resolutionMap = new Map(resolutions.map((row) => [row.decision_id, row]));
    return {
      ...expediente,
      impacto_snapshot: JSON.parse(expediente.impacto_snapshot_json),
      decisiones: decisions.map((row) => ({
        ...row,
        entrenador_destino_nombre: row.id_entrenador_destino
          ? targetMap.get(row.id_entrenador_destino) ?? row.id_entrenador_destino
          : null,
        resolucion_financiera: resolutionMap.get(row.decision_id) ?? null,
      })),
    };
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

  private openKey(gymId: string, trainerId: string) {
    return `${gymId}:${trainerId.trim()}`;
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

export function asTrainerOffboardingCaseError(error: unknown) {
  if (error instanceof TrainerOffboardingCaseError) return error;
  if (error instanceof TrainerOffboardingPolicyError) {
    return new TrainerOffboardingCaseError(error.message);
  }
  return null;
}
