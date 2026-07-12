import type { Asistencia } from "../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../domain/repositories/AsistenciaRepository";
import { prisma } from "../db/prismaClient";
import { trustedClock } from "../../config/trusted-clock";
import { env } from "../../config/env";
import { startOfDayInZone } from "../../config/tz";

const clienteSummary = {
    select: {
        ci: true,
        nombres: true,
        apellidos: true,
        foto_cliente: true,
    },
} as const;

export class PrismaAsistenciaRepository implements AsistenciaRepository {
    async upsertAsistencia(data: Asistencia): Promise<void> {
        await prisma.asistencia.upsert({
            where: { asistencia_id: data.asistencia_id },
            create: {
                asistencia_id: data.asistencia_id,
                ci: data.ci,
                fecha_salida: data.fecha_salida ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? trustedClock.nowUtc(),
                updated_at: trustedClock.nowUtc(),
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
                updated_at: trustedClock.nowUtc(),
                deleted_at: null,
                is_deleted: false,
                pausa_inicio: data.pausa_inicio ?? null,
                pausa_ms: data.pausa_ms ?? 0
            }
        });
    }

    async findAll(skip: number = 0, take: number = 10): Promise<Asistencia[]> {
        const results = await prisma.asistencia.findMany({
            skip,
            take,
            where: { is_deleted: false },
            orderBy: { created_at: "desc" },
            include: { cliente: clienteSummary },
        });
        return this.serializeClients(results);
    }

    async findActive(skip: number = 0, take: number = 100): Promise<Asistencia[]> {
        const results = await prisma.asistencia.findMany({
            skip,
            take,
            where: {
                is_deleted: false,
                fecha_salida: null,
            },
            orderBy: { created_at: "desc" },
            include: { cliente: clienteSummary },
        });
        return this.serializeClients(results);
    }

    async findToday(gymId?: string | null): Promise<Asistencia[]> {
        const gym = gymId
            ? await prisma.gym.findUnique({
                where: { gym_id: gymId },
                select: { timezone: true },
            })
            : null;
        const { startUtc: startOfDay, endUtc: endOfDay } = startOfDayInZone(
            gym?.timezone ?? env.defaultGymTimezone,
            trustedClock.nowUtc(),
        );

        const results = await prisma.asistencia.findMany({
            where: {
                is_deleted: false,
                ...(gymId ? { gym_id: gymId } : {}),
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

    async findById(id: string): Promise<Asistencia | null> {
        return prisma.asistencia.findFirst({
            where: { asistencia_id: id, is_deleted: false }
        });
    }

    async create(data: Asistencia): Promise<void> {
        await prisma.asistencia.create({
            data: {
                asistencia_id: data.asistencia_id,
                ci: data.ci,
                fecha_salida: data.fecha_salida ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? trustedClock.nowUtc(),
                updated_at: trustedClock.nowUtc(),
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
                fecha_salida: data.fecha_salida,
                gym_id: data.gym_id ?? undefined,
                version: { increment: 1 },
                updated_at: trustedClock.nowUtc()
            }
        });
    }

    async finalize(id: string, fechaSalida: Date): Promise<Asistencia> {
        return prisma.asistencia.update({
            where: { asistencia_id: id },
            data: {
                fecha_salida: fechaSalida,
                version: { increment: 1 },
                updated_at: fechaSalida,
            },
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.asistencia.update({
            where: { asistencia_id: id },
            data: {
                is_deleted: true,
                deleted_at: trustedClock.nowUtc(),
                updated_at: trustedClock.nowUtc()
            }
        });
    }
}
