import type { ClientePeso } from "../../domain/entities/ClientePeso";
import type { ClientePesoRepository } from "../../domain/repositories/ClientePesoRepository";
import { prisma } from "../db/prismaClient";

export class PrismaClientePesoRepository implements ClientePesoRepository {
    async upsertClientePeso(data: ClientePeso): Promise<void> {
        await prisma.clientePeso.upsert({
            where: { cliente_peso_id: data.cliente_peso_id },
            create: {
                cliente_peso_id: data.cliente_peso_id,
                ci: data.ci,
                fecha: data.fecha,
                peso: data.peso,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            },
            update: {
                ci: data.ci,
                fecha: data.fecha,
                peso: data.peso,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<ClientePeso[]> {
        return prisma.clientePeso.findMany({
            where: { is_deleted: false }
        });
    }

    async findById(id: string): Promise<ClientePeso | null> {
        return prisma.clientePeso.findUnique({
            where: { cliente_peso_id: id, is_deleted: false }
        });
    }

    async create(data: ClientePeso): Promise<void> {
        await prisma.clientePeso.create({
            data: {
                cliente_peso_id: data.cliente_peso_id,
                ci: data.ci,
                fecha: data.fecha,
                peso: data.peso,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, data: Partial<ClientePeso>): Promise<void> {
        await prisma.clientePeso.update({
            where: { cliente_peso_id: id },
            data: {
                ci: data.ci,
                fecha: data.fecha,
                peso: data.peso,
                gym_id: data.gym_id ?? undefined,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.clientePeso.update({
            where: { cliente_peso_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
