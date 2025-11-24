import type { Entrenador } from "../../domain/entities/Entrenador";
import type { EntrenadorRepository } from "../../domain/repositories/EntrenadorRepository";
import { prisma } from "../db/prismaClient";

export class PrismaEntrenadorRepository implements EntrenadorRepository {
    async upsertEntrenador(data: Entrenador): Promise<void> {
        await prisma.entrenador.upsert({
            where: { id_entrenador: data.id_entrenador },
            create: {
                id_entrenador: data.id_entrenador,
                ci_entrenador: data.ci_entrenador,
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
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            },
            update: {
                ci_entrenador: data.ci_entrenador,
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
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<Entrenador[]> {
        const result = await prisma.entrenador.findMany({
            where: { is_deleted: false }
        });
        return result.map(e => ({
            ...e,
            foto_entrenador: e.foto_entrenador ? new Uint8Array(e.foto_entrenador) : null,
            gym_id: e.gym_id ?? ""
        }));
    }

    async findById(id: string): Promise<Entrenador | null> {
        const result = await prisma.entrenador.findUnique({
            where: { id_entrenador: id, is_deleted: false }
        });
        if (!result) return null;
        return {
            ...result,
            foto_entrenador: result.foto_entrenador ? new Uint8Array(result.foto_entrenador) : null,
            gym_id: result.gym_id ?? ""
        };
    }

    async create(data: Entrenador): Promise<void> {
        await prisma.entrenador.create({
            data: {
                id_entrenador: data.id_entrenador,
                ci_entrenador: data.ci_entrenador,
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
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, data: Partial<Entrenador>): Promise<void> {
        await prisma.entrenador.update({
            where: { id_entrenador: id },
            data: {
                ci_entrenador: data.ci_entrenador,
                nombres_entrenador: data.nombres_entrenador,
                apellidos_entrenador: data.apellidos_entrenador,
                sexo_entrenador: data.sexo_entrenador,
                foto_entrenador: data.foto_entrenador ? Buffer.from(data.foto_entrenador) : undefined,
                direccion_entrenador: data.direccion_entrenador ?? undefined,
                telefono_entrenador: data.telefono_entrenador ?? undefined,
                correo_entrenador: data.correo_entrenador ?? undefined,
                activo_entrenador: data.activo_entrenador,
                fecha_incio_entrenador: data.fecha_incio_entrenador,
                gym_id: data.gym_id ?? undefined,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.entrenador.update({
            where: { id_entrenador: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
