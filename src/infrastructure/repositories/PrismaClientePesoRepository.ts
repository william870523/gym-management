import type { ClientePeso } from "../../domain/entities/ClientePeso";
import type { ClientePesoRepository } from "../../domain/repositories/ClientePesoRepository";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import {
    softDeleteGymScopedSyncRecord,
    upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";
import { assertGymScopedReference } from "./gym-scoped-reference";

export class PrismaClientePesoRepository implements ClientePesoRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaClientePesoRepository {
    return new PrismaClientePesoRepository(tx);
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

    async upsertClientePeso(data: ClientePeso): Promise<void> {
        const now = trustedClock.nowUtc();
        if (!data.gym_id) throw new Error("El evento de peso no tiene gimnasio autenticado.");
        await this.runInClient(async (tx) => {
            await assertGymScopedReference({
                delegate: tx.cliente,
                entity: "cliente",
                pk: "ci",
                id: data.ci,
                gymId: data.gym_id!,
            });
            await upsertGymScopedSyncRecord({
                delegate: tx.clientePeso,
                entity: "cliente_peso",
                pk: "cliente_peso_id",
                id: data.cliente_peso_id,
                gymId: data.gym_id,
                create: {
                    cliente_peso_id: data.cliente_peso_id,
                    ci: data.ci,
                    fecha: data.fecha,
                    peso: data.peso,
                    gym_id: data.gym_id,
                    source_device: data.source_device ?? null,
                    version: data.version,
                    created_at: data.created_at ?? now,
                    updated_at: now,
                    deleted_at: null,
                    is_deleted: false,
                },
                update: {
                    ci: data.ci,
                    fecha: data.fecha,
                    peso: data.peso,
                    gym_id: data.gym_id,
                    source_device: data.source_device ?? null,
                    version: data.version,
                    updated_at: now,
                    deleted_at: null,
                    is_deleted: false,
                },
            });
        });
    }

    async findAll(gymId: string, ci?: string): Promise<ClientePeso[]> {
        const where: any = { gym_id: gymId, is_deleted: false };
        if (ci) {
            where.ci = ci;
        }

        const pesos = await this.client.clientePeso.findMany({
            where,
            orderBy: { fecha: 'desc' }
        });

        // Map Prisma result to Domain Entity
        return pesos.map((p: any) => ({
            cliente_peso_id: p.cliente_peso_id,
            ci: p.ci,
            fecha: p.fecha,
            peso: p.peso,
            gym_id: p.gym_id,
            source_device: p.source_device,
            version: p.version,
            created_at: p.created_at,
            updated_at: p.updated_at,
            deleted_at: p.deleted_at,
            is_deleted: p.is_deleted
        }));
    }

    async findById(id: string, gymId: string): Promise<ClientePeso | null> {
        return this.client.clientePeso.findFirst({
            where: { cliente_peso_id: id, gym_id: gymId, is_deleted: false }
        });
    }

    async create(data: ClientePeso): Promise<void> {
        if (!data.gym_id) {
            throw new Error("El token debe identificar el gimnasio del peso.");
        }
        const client = await this.client.cliente.findFirst({
            where: { ci: data.ci, gym_id: data.gym_id, is_deleted: false },
            select: { ci: true },
        });
        if (!client) {
            throw new Error("El cliente no pertenece al gimnasio autenticado.");
        }
        const now = trustedClock.nowUtc();
        await this.client.clientePeso.create({
            data: {
                cliente_peso_id: data.cliente_peso_id,
                ci: data.ci,
                fecha: data.fecha,
                peso: data.peso,
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

    async update(id: string, gymId: string, data: Partial<ClientePeso>): Promise<void> {
        await this.runInClient(async (tx) => {
            if (data.ci) {
                const client = await tx.cliente.findFirst({
                    where: { ci: data.ci, gym_id: gymId, is_deleted: false },
                    select: { ci: true },
                });
                if (!client) throw new Error("El cliente no pertenece al gimnasio autenticado.");
            }
            const result = await tx.clientePeso.updateMany({
                where: { cliente_peso_id: id, gym_id: gymId, is_deleted: false },
                data: {
                ci: data.ci,
                fecha: data.fecha,
                peso: data.peso,
                version: { increment: 1 },
                updated_at: trustedClock.nowUtc()
                },
            });
            if (result.count !== 1) throw new Error("ClientePeso not found");
        });
    }

    async softDelete(id: string, gymId: string): Promise<void> {
        const now = trustedClock.nowUtc();
        await softDeleteGymScopedSyncRecord({
            delegate: this.client.clientePeso,
            entity: "cliente_peso",
            pk: "cliente_peso_id",
            id,
            gymId,
            now,
        });
    }
}
