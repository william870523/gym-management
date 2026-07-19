import type { Cliente, MembresiaCliente, Prisma } from "@prisma/client";
import { trustedClock } from "../../config/trusted-clock";
import { datePartsInZone } from "../../config/tz";
import {
  resolveMembershipPause,
  resolveMembershipResume,
} from "../../domain/membership-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";

type Tx = Prisma.TransactionClient;

export type MembershipOperationContext = {
  nowUtc: Date;
  businessToday: Date;
};

export class MembershipPauseError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export class MembershipPauseService {
  async pause(input: {
    gymId: string;
    clientId: string;
    membershipId: string;
    operationId: string;
    reason: string;
    userId?: string | null;
  }) {
    this.validateOperationId(input.operationId);
    const context = await this.operationContext(input.gymId);
    return prisma.$transaction((tx) =>
      this.pauseInTransaction(tx, input, context),
    );
  }

  async pauseInTransaction(
    tx: Tx,
    input: {
      gymId: string;
      clientId: string;
      membershipId: string;
      operationId: string;
      reason: string;
      userId?: string | null;
    },
    context: MembershipOperationContext,
  ) {
    this.validateOperationId(input.operationId);
    const { nowUtc, businessToday } = context;
    const duplicate = await tx.membresiaPausa.findUnique({
      where: { pausa_id: input.operationId },
    });
    if (duplicate) {
      if (
        duplicate.membresia_id !== input.membershipId ||
        duplicate.gym_id !== input.gymId
      ) {
        throw new MembershipPauseError(
          "La operación ya pertenece a otra membresía.",
        );
      }
      return {
        membership: await this.membership(tx, input),
        pause: duplicate,
        idempotent: true,
      };
    }

    const membership = await this.membership(tx, input);
    if (membership.estado !== "ACTIVA") {
      throw new MembershipPauseError(
        membership.estado === "PAUSADA"
          ? "La membresía ya está pausada."
          : "Solo se puede pausar una membresía activa.",
      );
    }
    const reason = input.reason.trim();
    if (reason.length < 5) {
      throw new MembershipPauseError(
        "El motivo debe tener al menos 5 caracteres.",
        400,
      );
    }
    const snapshot = resolveMembershipPause({
      membershipStart: membership.fecha_inicio,
      membershipEndExclusive: membership.fecha_fin,
      effectiveDate: businessToday,
    });
    const pause = await tx.membresiaPausa.create({
      data: {
        pausa_id: input.operationId,
        membresia_id: membership.membresia_id,
        fecha_pausa: snapshot.effectiveDate,
        fecha_reanudacion: null,
        fecha_fin_anterior: snapshot.previousEndExclusive,
        fecha_fin_recalculada: null,
        dias_restantes_snapshot: snapshot.remainingDays,
        motivo: reason,
        estado: "ACTIVA",
        activa_clave: membership.membresia_id,
        pausada_at: nowUtc,
        reanudada_at: null,
        registrada_por_user_id: input.userId ?? null,
        reanudada_por_user_id: null,
        reanudacion_operacion_id: null,
        is_deleted: false,
        created_at: nowUtc,
        gym_id: input.gymId,
        source_device: null,
        version: 1,
        updated_at: nowUtc,
        deleted_at: null,
      },
    });
    const updatedMembership = await tx.membresiaCliente.update({
      where: { membresia_id: membership.membresia_id },
      data: {
        estado: "PAUSADA",
        version: { increment: 1 },
        updated_at: nowUtc,
      },
    });
    const client = await this.updateClientProjection(tx, membership, {
      gymId: input.gymId,
      active: false,
      endExclusive: membership.fecha_fin,
      nowUtc,
    });
    await this.record(
      tx,
      input.gymId,
      "membresia_pausa",
      pause.pausa_id,
      pause,
      "INSERT",
    );
    await this.record(
      tx,
      input.gymId,
      "membresia_cliente",
      updatedMembership.membresia_id,
      updatedMembership,
      "UPDATE",
    );
    if (client) {
      await this.record(
        tx,
        input.gymId,
        "cliente",
        client.ci,
        client,
        "UPDATE",
      );
    }
    return { membership: updatedMembership, pause, idempotent: false };
  }

  async resume(input: {
    gymId: string;
    clientId: string;
    membershipId: string;
    operationId: string;
    userId?: string | null;
  }) {
    this.validateOperationId(input.operationId);
    const context = await this.operationContext(input.gymId);
    return prisma.$transaction((tx) =>
      this.resumeInTransaction(tx, input, context),
    );
  }

  async resumeInTransaction(
    tx: Tx,
    input: {
      gymId: string;
      clientId: string;
      membershipId: string;
      operationId: string;
      userId?: string | null;
    },
    context: MembershipOperationContext,
  ) {
    this.validateOperationId(input.operationId);
    const { nowUtc, businessToday } = context;
    const duplicate = await tx.membresiaPausa.findUnique({
      where: { reanudacion_operacion_id: input.operationId },
    });
    if (duplicate) {
      if (
        duplicate.membresia_id !== input.membershipId ||
        duplicate.gym_id !== input.gymId
      ) {
        throw new MembershipPauseError(
          "La operación ya pertenece a otra membresía.",
        );
      }
      return {
        membership: await this.membership(tx, input),
        pause: duplicate,
        idempotent: true,
      };
    }

    const membership = await this.membership(tx, input);
    if (membership.estado !== "PAUSADA") {
      throw new MembershipPauseError(
        "Solo se puede reanudar una membresía pausada.",
      );
    }
    const activePause = await tx.membresiaPausa.findUnique({
      where: { activa_clave: membership.membresia_id },
    });
    if (!activePause || activePause.estado !== "ACTIVA") {
      throw new MembershipPauseError(
        "La membresía pausada no tiene un intervalo activo para reanudar.",
      );
    }
    const resumed = resolveMembershipResume({
      pauseEffectiveDate: activePause.fecha_pausa,
      resumeEffectiveDate: businessToday,
      remainingDays: activePause.dias_restantes_snapshot,
    });
    const pause = await tx.membresiaPausa.update({
      where: { pausa_id: activePause.pausa_id },
      data: {
        fecha_reanudacion: resumed.effectiveDate,
        fecha_fin_recalculada: resumed.newEndExclusive,
        estado: "REANUDADA",
        activa_clave: null,
        reanudada_at: nowUtc,
        reanudada_por_user_id: input.userId ?? null,
        reanudacion_operacion_id: input.operationId,
        version: { increment: 1 },
        updated_at: nowUtc,
      },
    });
    const updatedMembership = await tx.membresiaCliente.update({
      where: { membresia_id: membership.membresia_id },
      data: {
        fecha_fin: resumed.newEndExclusive,
        estado: "ACTIVA",
        version: { increment: 1 },
        updated_at: nowUtc,
      },
    });
    const client = await this.updateClientProjection(tx, membership, {
      gymId: input.gymId,
      active: true,
      endExclusive: resumed.newEndExclusive,
      nowUtc,
    });
    await this.record(
      tx,
      input.gymId,
      "membresia_pausa",
      pause.pausa_id,
      pause,
      "UPDATE",
    );
    await this.record(
      tx,
      input.gymId,
      "membresia_cliente",
      updatedMembership.membresia_id,
      updatedMembership,
      "UPDATE",
    );
    if (client) {
      await this.record(
        tx,
        input.gymId,
        "cliente",
        client.ci,
        client,
        "UPDATE",
      );
    }
    return { membership: updatedMembership, pause, idempotent: false };
  }

  async operationContext(gymId: string): Promise<MembershipOperationContext> {
    const nowUtc = trustedClock.nowUtc();
    return { nowUtc, businessToday: await this.businessDate(gymId, nowUtc) };
  }

  private validateOperationId(value: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      throw new MembershipPauseError(
        "operation_id debe ser un UUID válido.",
        400,
      );
    }
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
    if (!membership) {
      throw new MembershipPauseError("Membresía no encontrada.", 404);
    }
    return membership;
  }

  private async businessDate(gymId: string, nowUtc: Date) {
    const gym = await prisma.gym.findUnique({
      where: { gym_id: gymId },
      select: { timezone: true },
    });
    if (!gym) throw new MembershipPauseError("Gimnasio no encontrado.", 404);
    if (!gym.timezone || gym.timezone === "Etc/UTC") {
      throw new MembershipPauseError(
        "El gimnasio debe tener configurada su zona horaria real antes de pausar o reanudar membresías.",
        409,
      );
    }
    const parts = datePartsInZone(gym.timezone, nowUtc);
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  }

  private async updateClientProjection(
    tx: Tx,
    membership: MembresiaCliente,
    input: {
      gymId: string;
      active: boolean;
      endExclusive: Date;
      nowUtc: Date;
    },
  ): Promise<Cliente | null> {
    const current = await tx.membresiaCliente.findFirst({
      where: {
        ci: membership.ci,
        gym_id: input.gymId,
        is_deleted: false,
        estado: { in: ["PENDIENTE_PAGO", "ACTIVA", "PAUSADA"] },
      },
      orderBy: [{ updated_at: "desc" }, { created_at: "desc" }],
      select: { membresia_id: true },
    });
    if (current?.membresia_id !== membership.membresia_id) return null;
    return tx.cliente.update({
      where: { ci: membership.ci },
      data: {
        activo: input.active,
        fecha_fin: input.endExclusive,
        version: { increment: 1 },
        updated_at: input.nowUtc,
      },
    });
  }

  private async record(
    tx: Tx,
    gymId: string,
    entity: string,
    entityId: string,
    payload: unknown,
    operation: "INSERT" | "UPDATE",
  ) {
    await tx.syncLog.create({
      data: {
        event_id: crypto.randomUUID(),
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
