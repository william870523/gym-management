import type { Referencia } from "../../domain/entities/Referencia";
import type { ReferenciaRepository } from "../../domain/repositories/ReferenciaRepository";
import { prisma } from "../db/prismaClient";

export class PrismaReferenciaRepository implements ReferenciaRepository {
    async upsertReferencia(data: Referencia): Promise<void> {
        await prisma.referencia.upsert({
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
        return prisma.referencia.findMany({
            where: { is_deleted: false }
        });
    }

    async findById(id: string): Promise<Referencia | null> {
        return prisma.referencia.findUnique({
            where: { referencia_id: id, is_deleted: false }
        });
    }

    async create(data: Referencia): Promise<void> {
        await prisma.referencia.create({
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
        await prisma.referencia.update({
            where: { referencia_id: id },
            data: {
                nombre_referencia: data.nombre_referencia,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.referencia.update({
            where: { referencia_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
