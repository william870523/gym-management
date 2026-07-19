import type { Prisma } from "@prisma/client";
import { env } from "../../config/env";
import { trustedClock } from "../../config/trusted-clock";
import { datePartsInZone } from "../../config/tz";
import {
  CompensationProfilePolicyError,
  compensationProfileStatusAt,
  compensationProfilesOverlap,
  normalizeCompensationProfileDraft,
  type CompensationProfileDraft,
  type CompensationProfileInterval,
} from "../../domain/compensation-profile-policy";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";

const ENTITY = "entrenador_compensacion_perfil";
type Tx = Prisma.TransactionClient;

export class CompensationProfileServiceError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "CompensationProfileServiceError";
  }
}

export class CompensationProfileService {
  async list(gymId: string) {
    const today = await this.businessToday(prisma as unknown as Tx, gymId);
    const profiles = await prisma.entrenadorCompensacionPerfil.findMany({
      where: { gym_id: gymId, is_deleted: false },
      orderBy: [{ fecha_inicio: "desc" }, { updated_at: "desc" }],
    });
    const conflictIds = new Set<string>();
    for (let left = 0; left < profiles.length; left += 1) {
      for (let right = left + 1; right < profiles.length; right += 1) {
        if (compensationProfilesOverlap(
          this.toInterval(profiles[left]),
          this.toInterval(profiles[right]),
        )) {
          conflictIds.add(profiles[left].perfil_id);
          conflictIds.add(profiles[right].perfil_id);
        }
      }
    }
    const trainerIds = [...new Set(profiles.map((row) => row.id_entrenador))];
    const accountIds = profiles
      .map((row) => row.cuenta_preferida_id)
      .filter((id): id is string => Boolean(id));
    const currencyIds = profiles
      .map((row) => row.moneda_id)
      .filter((id): id is string => Boolean(id));
    const [trainers, accounts, currencies] = await Promise.all([
      trainerIds.length
        ? prisma.entrenador.findMany({
            where: { gym_id: gymId, id_entrenador: { in: trainerIds } },
            select: {
              id_entrenador: true,
              nombres_entrenador: true,
              apellidos_entrenador: true,
              activo_entrenador: true,
            },
          })
        : [],
      accountIds.length
        ? prisma.cuenta.findMany({
            where: { gym_id: gymId, cuenta_id: { in: accountIds } },
            select: { cuenta_id: true, nombre_cuenta: true },
          })
        : [],
      currencyIds.length
        ? prisma.moneda.findMany({
            where: { moneda_id: { in: currencyIds } },
            select: { moneda_id: true, codigo: true },
          })
        : [],
    ]);
    const trainerMap = new Map(trainers.map((row) => [
      row.id_entrenador,
      {
        name: `${row.nombres_entrenador} ${row.apellidos_entrenador}`.trim(),
        active: row.activo_entrenador,
      },
    ]));
    const accountMap = new Map(accounts.map((row) => [row.cuenta_id, row.nombre_cuenta]));
    const currencyMap = new Map(currencies.map((row) => [row.moneda_id, row.codigo]));
    return profiles.map((row) => ({
      ...row,
      monto_fijo: row.monto_fijo?.toFixed(2) ?? null,
      entrenador_nombre: trainerMap.get(row.id_entrenador)?.name ?? row.id_entrenador,
      entrenador_activo: trainerMap.get(row.id_entrenador)?.active ?? false,
      cuenta_preferida_nombre: row.cuenta_preferida_id
        ? accountMap.get(row.cuenta_preferida_id) ?? row.cuenta_preferida_id
        : null,
      moneda_codigo: row.moneda_id ? currencyMap.get(row.moneda_id) ?? row.moneda_id : null,
      vigencia_estado: compensationProfileStatusAt(this.toInterval(row), today),
      tiene_conflicto: conflictIds.has(row.perfil_id),
    }));
  }

  async create(gymId: string, input: Record<string, unknown>) {
    const now = trustedClock.nowUtc();
    const today = await this.businessToday(prisma as unknown as Tx, gymId, now);
    const draft = normalizeCompensationProfileDraft(input, today);
    return prisma.$transaction(async (tx) => {
      await this.assertReferences(tx, gymId, draft);
      await this.assertNoOverlap(tx, gymId, draft);
      const created = await tx.entrenadorCompensacionPerfil.create({
        data: this.createData(gymId, draft, now),
      });
      await this.enqueue(tx, "INSERT", gymId, created);
      return this.present(created);
    });
  }

  async update(gymId: string, id: string, input: Record<string, unknown>) {
    const now = trustedClock.nowUtc();
    const today = await this.businessToday(prisma as unknown as Tx, gymId, now);
    const existing = await prisma.entrenadorCompensacionPerfil.findFirst({
      where: { perfil_id: id, gym_id: gymId, is_deleted: false },
    });
    if (!existing) throw new CompensationProfileServiceError("El perfil no existe.", 404);
    const status = compensationProfileStatusAt(this.toInterval(existing), today);
    if (status === "FINALIZADO") {
      throw new CompensationProfileServiceError(
        "Un perfil finalizado forma parte del historial y no se puede editar.",
        409,
      );
    }
    const draft = normalizeCompensationProfileDraft(input, existing.fecha_inicio);
    return prisma.$transaction(async (tx) => {
      await this.assertReferences(tx, gymId, draft);
      if (status === "VIGENTE" && existing.fecha_inicio.getTime() < today.getTime()) {
        const replacement = { ...draft, startDate: today, active: true };
        await this.assertNoOverlap(tx, gymId, replacement, [id]);
        const closed = await tx.entrenadorCompensacionPerfil.update({
          where: { perfil_id: id },
          data: { fecha_fin: today, updated_at: now, version: { increment: 1 } },
        });
        await this.enqueue(tx, "UPDATE", gymId, closed);
        const created = await tx.entrenadorCompensacionPerfil.create({
          data: this.createData(gymId, replacement, now),
        });
        await this.enqueue(tx, "INSERT", gymId, created);
        return { ...this.present(created), reemplaza_perfil_id: id };
      }

      await this.assertNoOverlap(tx, gymId, draft, [id]);
      const updated = await tx.entrenadorCompensacionPerfil.update({
        where: { perfil_id: id },
        data: {
          id_entrenador: draft.trainerId,
          modalidad: draft.modality,
          metodo_devengo: draft.earningMethod,
          frecuencia_desembolso: draft.payoutFrequency,
          dia_corte: draft.cutoffDay,
          monto_fijo: draft.fixedAmount,
          moneda_id: draft.currencyId,
          cuenta_preferida_id: draft.preferredAccountId,
          activo: true,
          fecha_inicio: draft.startDate,
          fecha_fin: draft.endDate,
          notas: draft.notes,
          updated_at: now,
          version: { increment: 1 },
        },
      });
      await this.enqueue(tx, "UPDATE", gymId, updated);
      return this.present(updated);
    });
  }

  async closeOrCancel(gymId: string, id: string) {
    const now = trustedClock.nowUtc();
    const today = await this.businessToday(prisma as unknown as Tx, gymId, now);
    return prisma.$transaction(async (tx) => {
      const existing = await tx.entrenadorCompensacionPerfil.findFirst({
        where: { perfil_id: id, gym_id: gymId, is_deleted: false },
      });
      if (!existing) throw new CompensationProfileServiceError("El perfil no existe.", 404);
      const status = compensationProfileStatusAt(this.toInterval(existing), today);
      if (status === "FINALIZADO") {
        throw new CompensationProfileServiceError("El perfil ya forma parte del historial.", 409);
      }
      if (existing.fecha_inicio.getTime() >= today.getTime() || status === "INACTIVO") {
        const cancelled = await tx.entrenadorCompensacionPerfil.update({
          where: { perfil_id: id },
          data: {
            activo: false,
            is_deleted: true,
            deleted_at: now,
            updated_at: now,
            version: { increment: 1 },
          },
        });
        await this.enqueue(tx, "DELETE", gymId, cancelled);
        return { ...this.present(cancelled), accion: "CANCELADO" };
      }
      const closed = await tx.entrenadorCompensacionPerfil.update({
        where: { perfil_id: id },
        data: { fecha_fin: today, updated_at: now, version: { increment: 1 } },
      });
      await this.enqueue(tx, "UPDATE", gymId, closed);
      return { ...this.present(closed), accion: "FINALIZADO" };
    });
  }

  async effectiveForTrainer(tx: Tx, gymId: string, trainerId: string, businessDate: Date) {
    return tx.entrenadorCompensacionPerfil.findFirst({
      where: {
        gym_id: gymId,
        id_entrenador: trainerId,
        activo: true,
        is_deleted: false,
        fecha_inicio: { lte: businessDate },
        OR: [{ fecha_fin: null }, { fecha_fin: { gt: businessDate } }],
      },
      orderBy: [{ fecha_inicio: "desc" }, { updated_at: "desc" }, { perfil_id: "desc" }],
    });
  }

  async businessDateForInstant(tx: Tx, gymId: string, instant: Date) {
    return this.businessToday(tx, gymId, instant);
  }

  private createData(gymId: string, draft: CompensationProfileDraft, now: Date) {
    return {
      perfil_id: crypto.randomUUID(),
      id_entrenador: draft.trainerId,
      modalidad: draft.modality,
      metodo_devengo: draft.earningMethod,
      frecuencia_desembolso: draft.payoutFrequency,
      dia_corte: draft.cutoffDay,
      monto_fijo: draft.fixedAmount,
      moneda_id: draft.currencyId,
      cuenta_preferida_id: draft.preferredAccountId,
      activo: true,
      fecha_inicio: draft.startDate,
      fecha_fin: draft.endDate,
      notas: draft.notes,
      is_deleted: false,
      created_at: now,
      gym_id: gymId,
      source_device: "WEB_ADMIN",
      version: 1,
      updated_at: now,
      deleted_at: null,
    };
  }

  private async assertReferences(tx: Tx, gymId: string, draft: CompensationProfileDraft) {
    const trainer = await tx.entrenador.findFirst({
      where: {
        id_entrenador: draft.trainerId,
        gym_id: gymId,
        activo_entrenador: true,
        is_deleted: false,
      },
    });
    if (!trainer) {
      throw new CompensationProfileServiceError("El entrenador no existe o está inactivo.", 404);
    }
    const currency = draft.currencyId
      ? await tx.moneda.findFirst({
          where: { moneda_id: draft.currencyId, is_deleted: false },
        })
      : null;
    if (draft.currencyId && !currency) {
      throw new CompensationProfileServiceError("La moneda fija no existe.", 404);
    }
    if (!draft.preferredAccountId) return;
    const account = await tx.cuenta.findFirst({
      where: {
        cuenta_id: draft.preferredAccountId,
        gym_id: gymId,
        is_deleted: false,
      },
    });
    if (!account) throw new CompensationProfileServiceError("La cuenta preferida no existe.", 404);
    if (draft.currencyId && account.moneda_id !== draft.currencyId) {
      throw new CompensationProfileServiceError(
        "La cuenta preferida debe usar la moneda del importe fijo.",
        409,
      );
    }
  }

  private async assertNoOverlap(
    tx: Tx,
    gymId: string,
    draft: CompensationProfileDraft,
    excluded: string[] = [],
  ) {
    const existing = await tx.entrenadorCompensacionPerfil.findMany({
      where: {
        gym_id: gymId,
        id_entrenador: draft.trainerId,
        activo: true,
        is_deleted: false,
        ...(excluded.length ? { perfil_id: { notIn: excluded } } : {}),
      },
    });
    if (existing.some((row) => compensationProfilesOverlap(
      this.draftInterval(draft),
      this.toInterval(row),
    ))) {
      throw new CompensationProfileServiceError(
        "La vigencia se solapa con otro perfil del entrenador.",
        409,
      );
    }
  }

  async businessToday(tx: Tx, gymId: string, instant = trustedClock.nowUtc()) {
    const gym = await tx.gym.findUnique({
      where: { gym_id: gymId },
      select: { timezone: true },
    });
    const parts = datePartsInZone(
      gym?.timezone?.trim() || env.defaultGymTimezone,
      instant,
    );
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  }

  private toInterval(row: {
    id_entrenador: string;
    fecha_inicio: Date;
    fecha_fin: Date | null;
    activo: boolean;
    is_deleted: boolean;
  }): CompensationProfileInterval {
    return {
      trainerId: row.id_entrenador,
      startDate: row.fecha_inicio,
      endDate: row.fecha_fin,
      active: row.activo,
      deleted: row.is_deleted,
    };
  }

  private draftInterval(draft: CompensationProfileDraft): CompensationProfileInterval {
    return {
      trainerId: draft.trainerId,
      startDate: draft.startDate,
      endDate: draft.endDate,
      active: draft.active,
      deleted: false,
    };
  }

  private present<T extends { monto_fijo: { toFixed(value: number): string } | null }>(row: T) {
    return { ...row, monto_fijo: row.monto_fijo?.toFixed(2) ?? null };
  }

  private async enqueue(
    tx: Tx,
    operation: "INSERT" | "UPDATE" | "DELETE",
    gymId: string,
    row: { perfil_id: string },
  ) {
    await tx.syncLog.create({
      data: {
        event_id: crypto.randomUUID(),
        entidad: ENTITY,
        operacion: operation,
        entidad_id: row.perfil_id,
        gym_id: gymId,
        device_id: "WEB_ADMIN",
        payload_json: JSON.stringify(serialize(row)),
      },
    });
  }
}

export function asCompensationProfileServiceError(error: unknown) {
  if (error instanceof CompensationProfileServiceError) return error;
  if (error instanceof CompensationProfilePolicyError) {
    return new CompensationProfileServiceError(error.message, 400);
  }
  return null;
}

