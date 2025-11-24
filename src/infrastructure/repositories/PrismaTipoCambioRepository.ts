import type { TipoCambio } from "../../domain/entities/TipoCambio";
import type { TipoCambioRepository } from "../../domain/repositories/TipoCambioRepository";
import { prisma } from "../db/prismaClient";

export class PrismaTipoCambioRepository implements TipoCambioRepository {
    async upsertTipoCambio(data: TipoCambio): Promise<void> {
        await prisma.tipoCambio.upsert({
            where: { tipo_cambio_id: data.tipo_cambio_id },
            create: {
                tipo_cambio_id: data.tipo_cambio_id,
                moneda_id_base: data.moneda_id_base,
                moneda_id_target: data.moneda_id_target,
                exchange_rate: data.exchange_rate,
                fecha_inicio: data.fecha_inicio,
                fecha_expiracion: data.fecha_expiracion ?? null,
                activo: data.activo,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            },
            update: {
                moneda_id_base: data.moneda_id_base,
                moneda_id_target: data.moneda_id_target,
                exchange_rate: data.exchange_rate,
                fecha_inicio: data.fecha_inicio,
                fecha_expiracion: data.fecha_expiracion ?? null,
                activo: data.activo,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<TipoCambio[]> {
        return prisma.tipoCambio.findMany({
            where: { is_deleted: false }
        });
    }

    async findById(id: string): Promise<TipoCambio | null> {
        return prisma.tipoCambio.findUnique({
            where: { tipo_cambio_id: id, is_deleted: false }
        });
    }

    async create(data: TipoCambio): Promise<void> {
        await prisma.tipoCambio.create({
            data: {
                tipo_cambio_id: data.tipo_cambio_id,
                moneda_id_base: data.moneda_id_base,
                moneda_id_target: data.moneda_id_target,
                exchange_rate: data.exchange_rate,
                fecha_inicio: data.fecha_inicio,
                fecha_expiracion: data.fecha_expiracion ?? null,
                activo: data.activo,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, data: Partial<TipoCambio>): Promise<void> {
        await prisma.tipoCambio.update({
            where: { tipo_cambio_id: id },
            data: {
                moneda_id_base: data.moneda_id_base,
                moneda_id_target: data.moneda_id_target,
                exchange_rate: data.exchange_rate,
                fecha_inicio: data.fecha_inicio,
                fecha_expiracion: data.fecha_expiracion ?? null,
                activo: data.activo,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.tipoCambio.update({
            where: { tipo_cambio_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
