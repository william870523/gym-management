import type { Nacionalidad } from "../../domain/entities/Nacionalidad";
import type { NacionalidadRepository } from "../../domain/repositories/NacionalidadRepository";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";

export class PrismaNacionalidadRepository implements NacionalidadRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaNacionalidadRepository {
    return new PrismaNacionalidadRepository(tx);
  }

    async upsertNacionalidad(data: Nacionalidad): Promise<void> {
        await this.client.nacionalidad.upsert({
            where: { nacionalidad_id: data.nacionalidad_id },
            create: {
                nacionalidad_id: data.nacionalidad_id,
                nacionalidad_nombre: data.nacionalidad_nombre,
                codigo_iso: data.codigo_iso,
                bandera: data.bandera ? Buffer.from(data.bandera) : null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            },
            update: {
                nacionalidad_nombre: data.nacionalidad_nombre,
                codigo_iso: data.codigo_iso,
                bandera: data.bandera ? Buffer.from(data.bandera) : null,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<Nacionalidad[]> {
        const result = await this.client.nacionalidad.findMany({
            where: { is_deleted: false }
        });
        return result.map((n: any) => ({
            ...n,
            bandera: n.bandera ? new Uint8Array(n.bandera) : null
        }));
    }

    async findById(id: string): Promise<Nacionalidad | null> {
        const result = await this.client.nacionalidad.findUnique({
            where: { nacionalidad_id: id, is_deleted: false }
        });
        if (!result) return null;
        return {
            ...result,
            bandera: result.bandera ? new Uint8Array(result.bandera) : null
        };
    }

    async create(data: Nacionalidad): Promise<void> {
        await this.client.nacionalidad.create({
            data: {
                nacionalidad_id: data.nacionalidad_id,
                nacionalidad_nombre: data.nacionalidad_nombre,
                codigo_iso: data.codigo_iso,
                bandera: data.bandera ? Buffer.from(data.bandera) : null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, data: Partial<Nacionalidad>): Promise<void> {
        await this.client.nacionalidad.update({
            where: { nacionalidad_id: id },
            data: {
                nacionalidad_nombre: data.nacionalidad_nombre,
                codigo_iso: data.codigo_iso,
                bandera: data.bandera === undefined ? undefined : (data.bandera ? Buffer.from(data.bandera) : null),
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await this.client.nacionalidad.update({
            where: { nacionalidad_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }

    async findByCode(code: string): Promise<Nacionalidad | null> {
        const result = await this.client.nacionalidad.findUnique({
            where: { codigo_iso: code }
        });
        if (!result) return null;
        return {
            ...result,
            bandera: result.bandera ? new Uint8Array(result.bandera) : null
        };
    }
}
