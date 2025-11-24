import type { Horario } from "../../domain/entities/Horario";
import type { HorarioRepository } from "../../domain/repositories/HorarioRepository";
import { prisma } from "../db/prismaClient";

export class PrismaHorarioRepository implements HorarioRepository {
    async upsertHorario(data: Horario): Promise<void> {
        await prisma.horario.upsert({
            where: { horario_id: data.horario_id },
            create: {
                horario_id: data.horario_id,
                nombre_horario: data.nombre_horario,
                hora_inicio: data.hora_inicio,
                hora_fin: data.hora_fin,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
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
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<Horario[]> {
        return prisma.horario.findMany({
            where: { is_deleted: false }
        });
    }

    async findById(id: string): Promise<Horario | null> {
        return prisma.horario.findUnique({
            where: { horario_id: id, is_deleted: false }
        });
    }

    async create(data: Horario): Promise<void> {
        await prisma.horario.create({
            data: {
                horario_id: data.horario_id,
                nombre_horario: data.nombre_horario,
                hora_inicio: data.hora_inicio,
                hora_fin: data.hora_fin,
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

    async update(id: string, data: Partial<Horario>): Promise<void> {
        await prisma.horario.update({
            where: { horario_id: id },
            data: {
                nombre_horario: data.nombre_horario,
                hora_inicio: data.hora_inicio,
                hora_fin: data.hora_fin,
                gym_id: data.gym_id ?? null,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.horario.update({
            where: { horario_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
