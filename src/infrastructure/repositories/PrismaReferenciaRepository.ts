import type { Referencia } from "../../domain/entities/Referencia";
import type { ReferenciaRepository } from "../../domain/repositories/ReferenciaRepository";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";

export class PrismaReferenciaRepository implements ReferenciaRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaReferenciaRepository {
    return new PrismaReferenciaRepository(tx);
  }

    async upsertReferencia(data: Referencia): Promise<void> {
        await this.client.referencia.upsert({
            where: { referencia_id: data.referencia_id },
            create: {
                referencia_id: data.referencia_id,
                nombre_referencia: data.nombre_referencia,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            },
            update: {
                nombre_referencia: data.nombre_referencia,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<Referencia[]> {
        return this.client.referencia.findMany({
            where: { is_deleted: false }
        });
    }

    async findById(id: string): Promise<Referencia | null> {
        return this.client.referencia.findUnique({
            where: { referencia_id: id, is_deleted: false }
        });
    }

    async create(data: Referencia): Promise<void> {
        await this.client.referencia.create({
            data: {
                referencia_id: data.referencia_id,
                nombre_referencia: data.nombre_referencia,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, data: Partial<Referencia>): Promise<void> {
        await this.client.referencia.update({
            where: { referencia_id: id },
            data: {
                nombre_referencia: data.nombre_referencia,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await this.client.referencia.update({
            where: { referencia_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
