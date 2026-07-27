import type { Entrenador } from "../../domain/entities/Entrenador";
import type { EntrenadorRepository } from "../../domain/repositories/EntrenadorRepository";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import {
    softDeleteGymScopedSyncRecord,
    upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";

export class PrismaEntrenadorRepository implements EntrenadorRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaEntrenadorRepository {
    return new PrismaEntrenadorRepository(tx);
  }

    async upsertEntrenador(data: Entrenador): Promise<void> {
        const now = trustedClock.nowUtc();
        await upsertGymScopedSyncRecord({
            delegate: this.client.entrenador,
            entity: "entrenador",
            pk: "id_entrenador",
            id: data.id_entrenador,
            gymId: data.gym_id,
            create: {
                id_entrenador: data.id_entrenador,
                ci_entrenador: data.ci_entrenador,
                tipo_documento: data.tipo_documento,
                nombres_entrenador: data.nombres_entrenador,
                apellidos_entrenador: data.apellidos_entrenador,
                sexo_entrenador: data.sexo_entrenador,
                foto_entrenador: data.foto_entrenador ? Buffer.from(data.foto_entrenador) : null,
                direccion_entrenador: data.direccion_entrenador ?? null,
                telefono_entrenador: data.telefono_entrenador ?? null,
                correo_entrenador: data.correo_entrenador ?? null,
                activo_entrenador: data.activo_entrenador,
                fecha_incio_entrenador: data.fecha_incio_entrenador,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            },
            update: {
                ci_entrenador: data.ci_entrenador,
                tipo_documento: data.tipo_documento,
                nombres_entrenador: data.nombres_entrenador,
                apellidos_entrenador: data.apellidos_entrenador,
                sexo_entrenador: data.sexo_entrenador,
                foto_entrenador: data.foto_entrenador ? Buffer.from(data.foto_entrenador) : null,
                direccion_entrenador: data.direccion_entrenador ?? null,
                telefono_entrenador: data.telefono_entrenador ?? null,
                correo_entrenador: data.correo_entrenador ?? null,
                activo_entrenador: data.activo_entrenador,
                fecha_incio_entrenador: data.fecha_incio_entrenador,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(gymId: string): Promise<Entrenador[]> {
        const result = await this.client.entrenador.findMany({
            where: { gym_id: gymId, is_deleted: false }
        });
        return result.map((e: any) => ({
            ...e,
            foto_entrenador: e.foto_entrenador ? new Uint8Array(e.foto_entrenador) : null,
            telefono_entrenador: e.telefono_entrenador == null
                ? null
                : Number(e.telefono_entrenador),
            gym_id: e.gym_id ?? ""
        }));
    }

    async findById(id: string, gymId: string): Promise<Entrenador | null> {
        const result = await this.client.entrenador.findFirst({
            where: { id_entrenador: id, gym_id: gymId, is_deleted: false }
        });
        if (!result) return null;
        return {
            ...result,
            foto_entrenador: result.foto_entrenador ? new Uint8Array(result.foto_entrenador) : null,
            telefono_entrenador: result.telefono_entrenador == null
                ? null
                : Number(result.telefono_entrenador),
            gym_id: result.gym_id ?? ""
        };
    }

    async create(data: Entrenador): Promise<void> {
        if (!data.gym_id) {
            throw new Error("El token debe identificar el gimnasio del entrenador.");
        }
        const now = trustedClock.nowUtc();
        await this.client.entrenador.create({
            data: {
                id_entrenador: data.id_entrenador,
                ci_entrenador: data.ci_entrenador,
                tipo_documento: data.tipo_documento,
                nombres_entrenador: data.nombres_entrenador,
                apellidos_entrenador: data.apellidos_entrenador,
                sexo_entrenador: data.sexo_entrenador,
                foto_entrenador: data.foto_entrenador ? Buffer.from(data.foto_entrenador) : null,
                direccion_entrenador: data.direccion_entrenador ?? null,
                telefono_entrenador: data.telefono_entrenador ?? null,
                correo_entrenador: data.correo_entrenador ?? null,
                activo_entrenador: data.activo_entrenador,
                fecha_incio_entrenador: data.fecha_incio_entrenador,
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

    async update(id: string, gymId: string, data: Partial<Entrenador>): Promise<void> {
        const result = await this.client.entrenador.updateMany({
            where: { id_entrenador: id, gym_id: gymId, is_deleted: false },
            data: {
                ci_entrenador: data.ci_entrenador,
                tipo_documento: data.tipo_documento,
                nombres_entrenador: data.nombres_entrenador,
                apellidos_entrenador: data.apellidos_entrenador,
                sexo_entrenador: data.sexo_entrenador,
                foto_entrenador: data.foto_entrenador ? Buffer.from(data.foto_entrenador) : undefined,
                direccion_entrenador: data.direccion_entrenador ?? undefined,
                telefono_entrenador: data.telefono_entrenador ?? undefined,
                correo_entrenador: data.correo_entrenador ?? undefined,
                activo_entrenador: data.activo_entrenador,
                fecha_incio_entrenador: data.fecha_incio_entrenador,
                version: { increment: 1 },
                updated_at: trustedClock.nowUtc()
            }
        });
        if (result.count !== 1) throw new Error("Entrenador not found");
    }

    async softDelete(id: string, gymId: string): Promise<void> {
        const now = trustedClock.nowUtc();
        await softDeleteGymScopedSyncRecord({
            delegate: this.client.entrenador,
            entity: "entrenador",
            pk: "id_entrenador",
            id,
            gymId,
            now,
        });
    }
}
