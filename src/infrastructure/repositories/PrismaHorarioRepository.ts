import type { Horario } from "../../domain/entities/Horario";
import type { HorarioRepository } from "../../domain/repositories/HorarioRepository";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";
import {
    softDeleteGymScopedSyncRecord,
    upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";
import { delegateFor, type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";

export class PrismaHorarioRepository implements HorarioRepository {
    constructor(private readonly horarioDelegate: any = prisma.horario) {}

    // Devuelve una copia del repositorio ligada a la transacción del upload
    // (Unidad 01). La escritura de la entidad ocurre entonces con el mismo
    // cliente que registra el sync_log, y revierte junto a él.
    withTransaction(tx: SyncTransactionContext): PrismaHorarioRepository {
        return new PrismaHorarioRepository(delegateFor(tx, "horario", this.horarioDelegate));
    }

    async upsertHorario(data: Horario): Promise<void> {
        const now = trustedClock.nowUtc();
        await upsertGymScopedSyncRecord({
            delegate: this.horarioDelegate,
            entity: "horario",
            pk: "horario_id",
            id: data.horario_id,
            gymId: data.gym_id,
            create: {
                horario_id: data.horario_id,
                nombre_horario: data.nombre_horario,
                hora_inicio: data.hora_inicio,
                hora_fin: data.hora_fin,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            },
            update: {
                nombre_horario: data.nombre_horario,
                hora_inicio: data.hora_inicio,
                hora_fin: data.hora_fin,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(gymId: string): Promise<Horario[]> {
        return this.horarioDelegate.findMany({
            where: {
                gym_id: this.requireGymId(gymId),
                is_deleted: false,
            }
        });
    }

    async findById(id: string, gymId: string): Promise<Horario | null> {
        return this.horarioDelegate.findFirst({
            where: {
                horario_id: id,
                gym_id: this.requireGymId(gymId),
                is_deleted: false,
            }
        });
    }

    async create(data: Horario, gymId: string): Promise<void> {
        const now = trustedClock.nowUtc();
        await this.horarioDelegate.create({
            data: {
                horario_id: data.horario_id,
                nombre_horario: data.nombre_horario,
                hora_inicio: data.hora_inicio,
                hora_fin: data.hora_fin,
                gym_id: this.requireGymId(gymId),
                source_device: "WEB_ADMIN",
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: data.updated_at ?? now,
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, gymId: string, data: Partial<Horario>): Promise<void> {
        const updated = await this.horarioDelegate.updateMany({
            where: {
                horario_id: id,
                gym_id: this.requireGymId(gymId),
                is_deleted: false,
            },
            data: {
                nombre_horario: data.nombre_horario,
                hora_inicio: data.hora_inicio,
                hora_fin: data.hora_fin,
                source_device: "WEB_ADMIN",
                version: data.version ?? { increment: 1 },
                updated_at: data.updated_at ?? trustedClock.nowUtc()
            }
        });
        if (updated.count !== 1) throw new Error("Horario not found");
    }

    async softDelete(id: string, gymId: string): Promise<void> {
        await softDeleteGymScopedSyncRecord({
            delegate: this.horarioDelegate,
            entity: "horario",
            pk: "horario_id",
            id,
            gymId: this.requireGymId(gymId),
            now: trustedClock.nowUtc(),
        });
    }

    private requireGymId(gymId: string) {
        const normalized = gymId.trim();
        if (!normalized) throw new Error("Gym scope required");
        return normalized;
    }
}
