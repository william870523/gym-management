import type { Prisma } from "@prisma/client";
import {
  assertIndependentApprover,
  isIdempotentDecision,
  previewMembershipRequest,
  type MembershipRequestKind,
} from "../../domain/membership-request-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { MembershipPauseService } from "./membership-pause.service";

type Tx = Prisma.TransactionClient;
type DecisionState = "APROBADA" | "RECHAZADA";

export class MembershipRequestError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export class MembershipRequestService {
  constructor(private readonly pauseService = new MembershipPauseService()) {}

  async create(input: {
    gymId: string;
    clientId: string;
    membershipId: string;
    kind: string;
    operationId: string;
    reason: string;
    userId: string;
  }) {
    this.validateUuid(input.operationId, "operation_id");
    const kind = this.kind(input.kind);
    const reason = this.reason(input.reason);
    const context = await this.pauseService.operationContext(input.gymId);

    return prisma
      .$transaction(async (tx) => {
        const duplicate = await tx.membresiaSolicitud.findUnique({
          where: { solicitud_id: input.operationId },
        });
        if (duplicate) {
          if (
            duplicate.gym_id !== input.gymId ||
            duplicate.membresia_id !== input.membershipId ||
            duplicate.tipo !== kind ||
            duplicate.solicitada_por_user_id !== input.userId
          ) {
            throw new MembershipRequestError(
              "La operación ya pertenece a otra solicitud.",
            );
          }
          return { request: duplicate, idempotent: true };
        }

        const membership = await this.membership(tx, input);
        const pending = await tx.membresiaSolicitud.findUnique({
          where: { pendiente_clave: membership.membresia_id },
        });
        if (pending) {
          throw new MembershipRequestError(
            "Esta membresía ya tiene una solicitud pendiente.",
          );
        }
        const activePause =
          kind === "REANUDAR"
            ? await tx.membresiaPausa.findUnique({
                where: { activa_clave: membership.membresia_id },
              })
            : null;
        let preview;
        try {
          preview = previewMembershipRequest({
            kind,
            membershipState: membership.estado,
            membershipStart: membership.fecha_inicio,
            membershipEndExclusive: membership.fecha_fin,
            requestedDate: context.businessToday,
            activePauseDate: activePause?.fecha_pausa,
            activePauseRemainingDays: activePause?.dias_restantes_snapshot,
          });
        } catch (error) {
          throw new MembershipRequestError((error as Error).message);
        }
        const requesterName = await this.identityName(
          tx,
          input.gymId,
          input.userId,
        );
        const request = await tx.membresiaSolicitud.create({
          data: {
            solicitud_id: input.operationId,
            membresia_id: membership.membresia_id,
            ci: membership.ci,
            tipo: kind,
            motivo: reason,
            estado: "PENDIENTE",
            pendiente_clave: membership.membresia_id,
            fecha_efectiva_solicitada: context.businessToday,
            fecha_efectiva_aplicada: null,
            dias_restantes_estimados: preview.remainingDays,
            dias_restantes_aplicados: null,
            fecha_fin_estimada: preview.estimatedEndExclusive,
            fecha_fin_resultante: null,
            solicitada_por_user_id: input.userId,
            solicitada_por_nombre_snapshot: requesterName,
            solicitada_at: context.nowUtc,
            decidida_por_user_id: null,
            decidida_por_nombre_snapshot: null,
            decision_motivo: null,
            decision_operacion_id: null,
            decidida_at: null,
            is_deleted: false,
            created_at: context.nowUtc,
            gym_id: input.gymId,
            source_device: null,
            version: 1,
            updated_at: context.nowUtc,
            deleted_at: null,
          },
        });
        await this.record(tx, input.gymId, request, "INSERT");
        return { request, idempotent: false };
      })
      .catch((error: unknown) => {
        if ((error as { code?: string }).code === "P2002") {
          throw new MembershipRequestError(
            "Esta membresía ya tiene una solicitud pendiente.",
          );
        }
        throw error;
      });
  }

  async list(input: {
    gymId: string;
    state?: string | null;
    limit?: number;
    userId?: string | null;
    onlyMine?: boolean;
  }) {
    const state = input.state?.trim().toUpperCase();
    if (
      state &&
      !["PENDIENTE", "APROBADA", "RECHAZADA", "CANCELADA"].includes(state)
    ) {
      throw new MembershipRequestError("Estado de solicitud inválido.", 400);
    }
    const requests = await prisma.membresiaSolicitud.findMany({
      where: {
        gym_id: input.gymId,
        is_deleted: false,
        ...(state ? { estado: state } : {}),
        ...(input.onlyMine && input.userId
          ? { solicitada_por_user_id: input.userId }
          : {}),
      },
      orderBy: [{ solicitada_at: "desc" }],
      take: Math.min(Math.max(input.limit ?? 100, 1), 250),
    });
    const membershipIds = [
      ...new Set(requests.map((item) => item.membresia_id)),
    ];
    const clientIds = [...new Set(requests.map((item) => item.ci))];
    const memberships = membershipIds.length
      ? await prisma.membresiaCliente.findMany({
          where: { membresia_id: { in: membershipIds }, gym_id: input.gymId },
          select: {
            membresia_id: true,
            plan_nombre_snapshot: true,
            estado: true,
            fecha_inicio: true,
            fecha_fin: true,
          },
        })
      : [];
    const clients = clientIds.length
      ? await prisma.cliente.findMany({
          where: { ci: { in: clientIds }, gym_id: input.gymId },
          select: { ci: true, nombres: true, apellidos: true },
        })
      : [];
    const membershipById = new Map(
      memberships.map((item) => [item.membresia_id, item]),
    );
    const clientById = new Map(clients.map((item) => [item.ci, item]));
    return requests.map((request) => ({
      ...request,
      membership: membershipById.get(request.membresia_id) ?? null,
      client: clientById.get(request.ci) ?? null,
    }));
  }

  async approve(input: {
    gymId: string;
    requestId: string;
    operationId: string;
    adminUserId: string;
    decisionReason?: string | null;
  }) {
    return this.decide({ ...input, requestedState: "APROBADA" });
  }

  async reject(input: {
    gymId: string;
    requestId: string;
    operationId: string;
    adminUserId: string;
    decisionReason: string;
  }) {
    return this.decide({ ...input, requestedState: "RECHAZADA" });
  }

  private async decide(input: {
    gymId: string;
    requestId: string;
    operationId: string;
    adminUserId: string;
    requestedState: DecisionState;
    decisionReason?: string | null;
  }) {
    this.validateUuid(input.requestId, "solicitud_id");
    this.validateUuid(input.operationId, "operation_id");
    const decisionReason = input.decisionReason?.trim() || null;
    if (
      input.requestedState === "RECHAZADA" &&
      (decisionReason?.length ?? 0) < 5
    ) {
      throw new MembershipRequestError(
        "El motivo del rechazo debe tener al menos 5 caracteres.",
        400,
      );
    }
    const context = await this.pauseService.operationContext(input.gymId);

    return prisma.$transaction(async (tx) => {
      const request = await tx.membresiaSolicitud.findFirst({
        where: {
          solicitud_id: input.requestId,
          gym_id: input.gymId,
          is_deleted: false,
        },
      });
      if (!request)
        throw new MembershipRequestError("Solicitud no encontrada.", 404);
      try {
        if (
          isIdempotentDecision({
            currentState: request.estado,
            requestedState: input.requestedState,
            storedOperationId: request.decision_operacion_id,
            operationId: input.operationId,
          })
        ) {
          return { request, idempotent: true };
        }
        assertIndependentApprover(
          request.solicitada_por_user_id,
          input.adminUserId,
        );
      } catch (error) {
        throw new MembershipRequestError((error as Error).message);
      }
      const approverName = await this.identityName(
        tx,
        input.gymId,
        input.adminUserId,
      );
      const claimed = await tx.membresiaSolicitud.updateMany({
        where: {
          solicitud_id: request.solicitud_id,
          estado: "PENDIENTE",
          version: request.version,
        },
        data: { estado: "EN_DECISION", updated_at: context.nowUtc },
      });
      if (claimed.count !== 1) {
        throw new MembershipRequestError(
          "Otra cuenta ya está decidiendo esta solicitud.",
        );
      }
      let pauseResult: Awaited<
        ReturnType<MembershipPauseService["pauseInTransaction"]>
      > | null = null;
      if (input.requestedState === "APROBADA") {
        pauseResult =
          request.tipo === "PAUSAR"
            ? await this.pauseService.pauseInTransaction(
                tx,
                {
                  gymId: input.gymId,
                  clientId: request.ci,
                  membershipId: request.membresia_id,
                  operationId: request.solicitud_id,
                  reason: request.motivo,
                  userId: input.adminUserId,
                },
                context,
              )
            : await this.pauseService.resumeInTransaction(
                tx,
                {
                  gymId: input.gymId,
                  clientId: request.ci,
                  membershipId: request.membresia_id,
                  operationId: request.solicitud_id,
                  userId: input.adminUserId,
                },
                context,
              );
      }
      const appliedPause = pauseResult?.pause ?? null;
      const updated = await tx.membresiaSolicitud.update({
        where: { solicitud_id: request.solicitud_id },
        data: {
          estado: input.requestedState,
          pendiente_clave: null,
          fecha_efectiva_aplicada:
            input.requestedState === "APROBADA" ? context.businessToday : null,
          dias_restantes_aplicados:
            input.requestedState === "APROBADA"
              ? appliedPause?.dias_restantes_snapshot
              : null,
          fecha_fin_resultante:
            input.requestedState === "APROBADA"
              ? (appliedPause?.fecha_fin_recalculada ??
                appliedPause?.fecha_fin_anterior ??
                null)
              : null,
          decidida_por_user_id: input.adminUserId,
          decidida_por_nombre_snapshot: approverName,
          decision_motivo: decisionReason,
          decision_operacion_id: input.operationId,
          decidida_at: context.nowUtc,
          version: { increment: 1 },
          updated_at: context.nowUtc,
        },
      });
      await this.record(tx, input.gymId, updated, "UPDATE");
      return {
        request: updated,
        membership: pauseResult?.membership ?? null,
        idempotent: false,
      };
    });
  }

  private async membership(
    tx: Tx,
    input: { gymId: string; clientId: string; membershipId: string },
  ) {
    const membership = await tx.membresiaCliente.findFirst({
      where: {
        membresia_id: input.membershipId,
        ci: input.clientId,
        gym_id: input.gymId,
        is_deleted: false,
      },
    });
    if (!membership)
      throw new MembershipRequestError("Membresía no encontrada.", 404);
    return membership;
  }

  private async identityName(tx: Tx, gymId: string, userId: string) {
    const user = await tx.user.findFirst({
      where: {
        user_id: userId,
        gym_id: gymId,
        active: true,
        is_deleted: false,
      },
      select: { user_nombre: true },
    });
    if (!user)
      throw new MembershipRequestError(
        "La cuenta operadora no está disponible.",
        403,
      );
    return user.user_nombre;
  }

  private kind(value: string): MembershipRequestKind {
    const kind = value.trim().toUpperCase();
    if (kind !== "PAUSAR" && kind !== "REANUDAR") {
      throw new MembershipRequestError("Tipo de solicitud inválido.", 400);
    }
    return kind;
  }

  private reason(value: string) {
    const reason = value.trim();
    if (reason.length < 5) {
      throw new MembershipRequestError(
        "El motivo debe tener al menos 5 caracteres.",
        400,
      );
    }
    return reason;
  }

  private validateUuid(value: string, field: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      throw new MembershipRequestError(
        `${field} debe ser un UUID válido.`,
        400,
      );
    }
  }

  private async record(
    tx: Tx,
    gymId: string,
    request: unknown & { solicitud_id: string },
    operation: "INSERT" | "UPDATE",
  ) {
    await tx.syncLog.create({
      data: {
        event_id: crypto.randomUUID(),
        entidad: "membresia_solicitud",
        operacion: operation,
        entidad_id: request.solicitud_id,
        gym_id: gymId,
        device_id: null,
        payload_json: JSON.stringify(serialize(request)),
      },
    });
  }
}
