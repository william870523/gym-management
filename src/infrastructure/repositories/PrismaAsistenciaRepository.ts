import type { Asistencia } from "../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../domain/repositories/AsistenciaRepository";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import { trustedClock } from "../../config/trusted-clock";
import { startOfDayInZone } from "../../config/tz";
import {
    softDeleteGymScopedSyncRecord,
    upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";
import { assertGymScopedReference } from "./gym-scoped-reference";

const clienteSummary = {
    select: {
        ci: true,
        nombres: true,
        apellidos: true,
        foto_cliente: true,
    },
} as const;

export class PrismaAsistenciaRepository implements AsistenciaRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaAsistenciaRepository {
    return new PrismaAsistenciaRepository(tx);
  }

  // Unidad 01: usa una transacción propia cuando `client` es el prisma raíz;
  // si ya es el cliente de una transacción (upload), la reutiliza en vez de
  // anidar otra —Prisma no soporta transacciones anidadas y un TransactionClient
  // no expone `$transaction`.
  private runInClient<T>(work: (c: any) => Promise<T>): Promise<T> {
    return typeof this.client.$transaction === "function"
      ? this.runInClient(work)
      : work(this.client);
  }

    async upsertAsistencia(data: Asistencia): Promise<void> {
        const now = trustedClock.nowUtc();
        if (!data.gym_id) throw new Error("El evento de asistencia no tiene gimnasio autenticado.");
        await this.runInClient(async (tx) => {
            await assertGymScopedReference({
                delegate: tx.cliente,
                entity: "cliente",
                pk: "ci",
                id: data.ci,
                gymId: data.gym_id!,
            });
            await upsertGymScopedSyncRecord({
            delegate: tx.asistencia,
            entity: "asistencia",
            pk: "asistencia_id",
            id: data.asistencia_id,
            gymId: data.gym_id,
            create: {
                asistencia_id: data.asistencia_id,
                ci: data.ci,
                fecha_salida: data.fecha_salida ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false,
                pausa_inicio: data.pausa_inicio ?? null,
                pausa_ms: data.pausa_ms ?? 0
            },
            update: {
                ci: data.ci,
                fecha_salida: data.fecha_salida ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: now,
                deleted_at: null,
                is_deleted: false,
                pausa_inicio: data.pausa_inicio ?? null,
                pausa_ms: data.pausa_ms ?? 0
            }
            });
        });
    }

    async findAll(
        gymId: string,
        skip: number = 0,
        take: number = 10,
        ci?: string,
    ): Promise<Asistencia[]> {
        const results = await this.client.asistencia.findMany({
            skip,
            take,
            where: { gym_id: gymId, ci, is_deleted: false },
            orderBy: { created_at: "desc" },
            include: { cliente: clienteSummary },
        });
        return this.serializeClients(results);
    }

    async findActive(gymId: string, skip: number = 0, take: number = 100): Promise<Asistencia[]> {
        const results = await this.client.asistencia.findMany({
            skip,
            take,
            where: {
                gym_id: gymId,
                is_deleted: false,
                fecha_salida: null,
            },
            orderBy: { created_at: "desc" },
            include: { cliente: clienteSummary },
        });
        return this.serializeClients(results);
    }

    async findToday(gymId: string): Promise<Asistencia[]> {
        const gym = await this.client.gym.findUnique({
            where: { gym_id: gymId },
            select: { timezone: true },
        });
        if (!gym?.timezone) throw new Error("Gym timezone not found");
        const { startUtc: startOfDay, endUtc: endOfDay } = startOfDayInZone(
            gym.timezone,
            trustedClock.nowUtc(),
        );

        const results = await this.client.asistencia.findMany({
            where: {
                is_deleted: false,
                gym_id: gymId,
                created_at: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
            },
            orderBy: { created_at: "desc" },
            include: { cliente: clienteSummary },
        });
        return this.serializeClients(results);
    }

    private serializeClients(results: any[]): Asistencia[] {
        return results.map((record) => ({
            ...record,
            cliente: record.cliente
                ? {
                    ...record.cliente,
                    foto_cliente: Buffer.isBuffer(record.cliente.foto_cliente)
                        ? record.cliente.foto_cliente.toString("base64")
                        : record.cliente.foto_cliente,
                }
                : null,
        })) as Asistencia[];
    }

    async findById(id: string, gymId: string): Promise<Asistencia | null> {
        return this.client.asistencia.findFirst({
            where: { asistencia_id: id, gym_id: gymId, is_deleted: false }
        });
    }

    async create(data: Asistencia): Promise<void> {
        if (!data.gym_id) throw new Error("El token debe identificar el gimnasio de la asistencia.");
        const client = await this.client.cliente.findFirst({
            where: { ci: data.ci, gym_id: data.gym_id, is_deleted: false },
            select: { ci: true },
        });
        if (!client) throw new Error("El cliente no pertenece al gimnasio autenticado.");
        const now = trustedClock.nowUtc();
        await this.client.asistencia.create({
            data: {
                asistencia_id: data.asistencia_id,
                ci: data.ci,
                fecha_salida: data.fecha_salida ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, gymId: string, data: Partial<Asistencia>): Promise<void> {
        await this.runInClient(async (tx) => {
            if (data.ci) {
                const client = await tx.cliente.findFirst({
                    where: { ci: data.ci, gym_id: gymId, is_deleted: false },
                    select: { ci: true },
                });
                if (!client) throw new Error("El cliente no pertenece al gimnasio autenticado.");
            }
            const result = await tx.asistencia.updateMany({
                where: { asistencia_id: id, gym_id: gymId, is_deleted: false },
                data: {
                ci: data.ci,
                fecha_salida: data.fecha_salida,
                version: { increment: 1 },
                updated_at: trustedClock.nowUtc()
                },
            });
            if (result.count !== 1) throw new Error("Asistencia not found");
        });
    }

    async finalize(id: string, gymId: string, fechaSalida: Date): Promise<Asistencia> {
        const result = await this.client.asistencia.updateMany({
            where: { asistencia_id: id, gym_id: gymId, is_deleted: false },
            data: {
                fecha_salida: fechaSalida,
                version: { increment: 1 },
                updated_at: fechaSalida,
            },
        });
        if (result.count !== 1) throw new Error("Asistencia not found");
        const updated = await this.findById(id, gymId);
        if (!updated) throw new Error("Asistencia not found");
        return updated;
    }

    async softDelete(id: string, gymId: string): Promise<void> {
        const now = trustedClock.nowUtc();
        await softDeleteGymScopedSyncRecord({
            delegate: this.client.asistencia,
            entity: "asistencia",
            pk: "asistencia_id",
            id,
            gymId,
            now,
        });
    }
}
