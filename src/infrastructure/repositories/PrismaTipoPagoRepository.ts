import type { TipoPago } from "../../domain/entities/TipoPago";
import type { TipoPagoRepository } from "../../domain/repositories/TipoPagoRepository";
import { prisma } from "../db/prismaClient";

export class PrismaTipoPagoRepository implements TipoPagoRepository {
    async upsertTipoPago(data: TipoPago): Promise<void> {
        await prisma.tipoPago.upsert({
            where: { tipo_pago_id: data.tipo_pago_id },
            create: {
                tipo_pago_id: data.tipo_pago_id,
                nombre_tipo_pago: data.nombre_tipo_pago,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            },
            update: {
                nombre_tipo_pago: data.nombre_tipo_pago,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<TipoPago[]> {
        return prisma.tipoPago.findMany({
            where: { is_deleted: false }
        });
    }

    async findById(id: string): Promise<TipoPago | null> {
        return prisma.tipoPago.findUnique({
            where: { tipo_pago_id: id, is_deleted: false }
        });
    }

    async create(data: TipoPago): Promise<void> {
        await prisma.tipoPago.create({
            data: {
                tipo_pago_id: data.tipo_pago_id,
                nombre_tipo_pago: data.nombre_tipo_pago,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, data: Partial<TipoPago>): Promise<void> {
        await prisma.tipoPago.update({
            where: { tipo_pago_id: id },
            data: {
                nombre_tipo_pago: data.nombre_tipo_pago,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.tipoPago.update({
            where: { tipo_pago_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
