import type { Moneda } from "../../domain/entities/Moneda";
import type { MonedaRepository } from "../../domain/repositories/MonedaRepository";
import { prisma } from "../db/prismaClient";

export class PrismaMonedaRepository implements MonedaRepository {
    async upsertMoneda(data: Moneda): Promise<void> {
        await prisma.moneda.upsert({
            where: { moneda_id: data.moneda_id },
            create: {
                moneda_id: data.moneda_id,
                moneda_nombre: data.moneda_nombre,
                codigo: data.codigo,
                simbolo: data.simbolo ?? null,
                imagen: data.imagen ? Buffer.from(data.imagen) : null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            },
            update: {
                moneda_nombre: data.moneda_nombre,
                codigo: data.codigo,
                simbolo: data.simbolo ?? null,
                imagen: data.imagen ? Buffer.from(data.imagen) : null,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<Moneda[]> {
        const result = await prisma.moneda.findMany({
            where: { is_deleted: false }
        });
        return result.map(m => ({
            ...m,
            imagen: m.imagen ? new Uint8Array(m.imagen) : null
        }));
    }

    async findById(id: string): Promise<Moneda | null> {
        const result = await prisma.moneda.findUnique({
            where: { moneda_id: id, is_deleted: false }
        });
        if (!result) return null;
        return {
            ...result,
            imagen: result.imagen ? new Uint8Array(result.imagen) : null
        };
    }

    async create(data: Moneda): Promise<void> {
        await prisma.moneda.create({
            data: {
                moneda_id: data.moneda_id,
                moneda_nombre: data.moneda_nombre,
                codigo: data.codigo,
                simbolo: data.simbolo ?? null,
                imagen: data.imagen ? Buffer.from(data.imagen) : null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, data: Partial<Moneda>): Promise<void> {
        await prisma.moneda.update({
            where: { moneda_id: id },
            data: {
                moneda_nombre: data.moneda_nombre,
                codigo: data.codigo,
                simbolo: data.simbolo ?? undefined,
                imagen: data.imagen ? Buffer.from(data.imagen) : undefined,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.moneda.update({
            where: { moneda_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
