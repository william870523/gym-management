import type { Prisma, RetencionGestion } from "@prisma/client";
import {
  normalizeRetentionManagement,
} from "../../domain/retention/retention-management-policy";
import { formatDateOnly } from "../../domain/retention/retention-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";
import { MembershipPauseService } from "../membership/membership-pause.service";

type Tx = Prisma.TransactionClient;

export class RetentionManagementError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export class RetentionManagementService {
  constructor(private readonly membershipService = new MembershipPauseService()) {}

  async create(input: {
    gymId: string;
    membershipId: string;
    operationId: string;
    result: string;
    channel: string;
    note?: string | null;
    promiseDate?: string | null;
    nextManagementDate?: string | null;
    reasonId?: string | null;
    userId: string;
  }) {
    this.validateUuid(input.operationId, "operation_id");
    const context = await this.membershipService.operationContext(input.gymId);
    let normalized;
    try {
      normalized = normalizeRetentionManagement({
        result: input.result,
        channel: input.channel,
        note: input.note,
        reasonId: input.reasonId,
        promiseDate: this.parseDateOnly(input.promiseDate, "promesa_fecha"),
        nextManagementDate: this.parseDateOnly(
          input.nextManagementDate,
          "proxima_gestion_fecha",
        ),
        businessToday: context.businessToday,
      });
    } catch (error) {
      throw new RetentionManagementError((error as Error).message, 400);
    }

    return prisma.$transaction(async (tx) => {
      const duplicate = await tx.retencionGestion.findUnique({
        where: { gestion_id: input.operationId },
      });
      if (duplicate) {
        if (!this.sameOperation(duplicate, input, normalized)) {
          throw new RetentionManagementError(
            "La operación ya pertenece a otra gestión de retención.",
          );
        }
        return { management: this.view(duplicate), idempotent: true };
      }

      const membership = await tx.membresiaCliente.findFirst({
        where: {
          membresia_id: input.membershipId,
          gym_id: input.gymId,
          is_deleted: false,
        },
        select: { membresia_id: true, ci: true },
      });
      if (!membership) {
        throw new RetentionManagementError("Membresía no encontrada.", 404);
      }
      const operatorName = await this.identityName(tx, input.gymId, input.userId);
      // E0-b: el motivo tiene que ser del catálogo de ESTA sede y estar activo.
      // Se congela el nombre para que renombrarlo después no reescriba la
      // historia, igual que `plan_nombre_snapshot` en las membresías.
      let reasonName: string | null = null;
      if (normalized.reasonId) {
        const reason = await tx.motivoBaja.findFirst({
          where: {
            motivo_baja_id: normalized.reasonId,
            gym_id: input.gymId,
            is_deleted: false,
          },
          select: { nombre: true, activo: true },
        });
        if (!reason) {
          throw new RetentionManagementError(
            "El motivo seleccionado no existe en este gimnasio.",
            400,
          );
        }
        if (!reason.activo) {
          throw new RetentionManagementError(
            "El motivo seleccionado está desactivado.",
            400,
          );
        }
        reasonName = reason.nombre;
      }
      const management = await tx.retencionGestion.create({
        data: {
          gestion_id: input.operationId,
          membresia_id: membership.membresia_id,
          ci: membership.ci,
          resultado: normalized.result,
          canal: normalized.channel,
          motivo_baja_id: normalized.reasonId,
          motivo_nombre_snapshot: reasonName,
          nota: normalized.note,
          promesa_fecha: normalized.promiseDate,
          proxima_gestion_fecha: normalized.nextManagementDate,
          registrada_por_user_id: input.userId,
          registrada_por_nombre_snapshot: operatorName,
          registrada_at: context.nowUtc,
          is_deleted: false,
          created_at: context.nowUtc,
          gym_id: input.gymId,
          source_device: null,
          version: 1,
          updated_at: context.nowUtc,
          deleted_at: null,
        },
      });
      await this.record(tx, input.gymId, management);
      return { management: this.view(management), idempotent: false };
    });
  }

  async list(gymId: string, membershipId: string, limit = 100) {
    const membership = await prisma.membresiaCliente.findFirst({
      where: { membresia_id: membershipId, gym_id: gymId, is_deleted: false },
      select: { membresia_id: true },
    });
    if (!membership) {
      throw new RetentionManagementError("Membresía no encontrada.", 404);
    }
    const rows = await prisma.retencionGestion.findMany({
      where: { membresia_id: membershipId, gym_id: gymId, is_deleted: false },
      orderBy: [{ registrada_at: "desc" }, { gestion_id: "desc" }],
      take: Math.min(Math.max(limit || 100, 1), 250),
    });
    return rows.map((row) => this.view(row));
  }

  private sameOperation(
    row: RetencionGestion,
    input: { gymId: string; membershipId: string; userId: string },
    normalized: ReturnType<typeof normalizeRetentionManagement>,
  ) {
    return row.gym_id === input.gymId
      && row.membresia_id === input.membershipId
      && row.registrada_por_user_id === input.userId
      && row.resultado === normalized.result
      && row.canal === normalized.channel
      && row.motivo_baja_id === normalized.reasonId
      && row.nota === normalized.note
      && this.sameDate(row.promesa_fecha, normalized.promiseDate)
      && this.sameDate(row.proxima_gestion_fecha, normalized.nextManagementDate);
  }

  private sameDate(a: Date | null, b: Date | null) {
    return a?.getTime() === b?.getTime();
  }

  private view(row: RetencionGestion) {
    return {
      management_id: row.gestion_id,
      membership_id: row.membresia_id,
      ci: row.ci,
      result: row.resultado,
      channel: row.canal,
      reason_id: row.motivo_baja_id,
      reason_name: row.motivo_nombre_snapshot,
      note: row.nota,
      promise_date: row.promesa_fecha ? formatDateOnly(row.promesa_fecha) : null,
      next_management_date: row.proxima_gestion_fecha
        ? formatDateOnly(row.proxima_gestion_fecha)
        : null,
      registered_by_user_id: row.registrada_por_user_id,
      registered_by: row.registrada_por_nombre_snapshot,
      registered_at_utc: row.registrada_at.toISOString(),
    };
  }

  private parseDateOnly(value: string | null | undefined, field: string) {
    if (!value?.trim()) return null;
    const normalized = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
    if (!match) {
      throw new RetentionManagementError(`${field} debe usar YYYY-MM-DD.`, 400);
    }
    const result = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    );
    if (formatDateOnly(result) !== normalized) {
      throw new RetentionManagementError(`${field} no es una fecha válida.`, 400);
    }
    return result;
  }

  private validateUuid(value: string, field: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new RetentionManagementError(`${field} debe ser un UUID válido.`, 400);
    }
  }

  private async identityName(tx: Tx, gymId: string, userId: string) {
    const user = await tx.user.findFirst({
      where: { user_id: userId, gym_id: gymId, active: true, is_deleted: false },
      select: { user_nombre: true },
    });
    if (!user) {
      throw new RetentionManagementError("La cuenta operadora no está disponible.", 403);
    }
    return user.user_nombre;
  }

  private async record(tx: Tx, gymId: string, management: RetencionGestion) {
    await tx.syncLog.create({
      data: {
        event_id: crypto.randomUUID(),
        entidad: "retencion_gestion",
        operacion: "INSERT",
        entidad_id: management.gestion_id,
        gym_id: gymId,
        device_id: null,
        payload_json: JSON.stringify(serialize(management)),
      },
    });
  }
}
