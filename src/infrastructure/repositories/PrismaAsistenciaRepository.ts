import type { Asistencia } from "../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../domain/repositories/AsistenciaRepository";
import { prisma } from "../db/prismaClient";

export class PrismaAsistenciaRepository implements AsistenciaRepository {
    async upsertAsistencia(data: Asistencia): Promise<void> {
        await prisma.asistencia.upsert({
            where: { asistencia_id: data.asistencia_id },
            create: {
                asistencia_id: data.asistencia_id,
                ci: data.ci,
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
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<Asistencia[]> {
        return prisma.asistencia.findMany({
            where: { is_deleted: false }
        });
    }

    async findById(id: string): Promise<Asistencia | null> {
        return prisma.asistencia.findUnique({
            where: { asistencia_id: id, is_deleted: false }
        });
    }

    async create(data: Asistencia): Promise<void> {
        await prisma.asistencia.create({
            data: {
                asistencia_id: data.asistencia_id,
                ci: data.ci,
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

    async update(id: string, data: Partial<Asistencia>): Promise<void> {
        await prisma.asistencia.update({
            where: { asistencia_id: id },
            data: {
                ci: data.ci,
                gym_id: data.gym_id ?? undefined,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.asistencia.update({
            where: { asistencia_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
