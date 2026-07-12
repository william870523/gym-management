import type { DetallePago } from "../../domain/entities/DetallePago";
import type { DetallePagoRepository } from "../../domain/repositories/DetallePagoRepository";
import { prisma } from "../db/prismaClient";

export class PrismaDetallePagoRepository implements DetallePagoRepository {
    async upsertDetallePago(data: DetallePago): Promise<void> {
        await prisma.detallePago.upsert({
            where: { detalle_pago_id: data.detalle_pago_id },
            create: {
                detalle_pago_id: data.detalle_pago_id,
                pago_cliente_id: data.pago_cliente_id,
                tipo_pago_id: data.tipo_pago_id,
                moneda_id: data.moneda_id,
                cuenta_id: data.cuenta_id ?? null,
                cantidad: data.cantidad,
                tipo_cambio_id: data.tipo_cambio_id ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            },
            update: {
                pago_cliente_id: data.pago_cliente_id,
                tipo_pago_id: data.tipo_pago_id,
                moneda_id: data.moneda_id,
                cuenta_id: data.cuenta_id ?? null,
                cantidad: data.cantidad,
                tipo_cambio_id: data.tipo_cambio_id ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<DetallePago[]> {
        return prisma.detallePago.findMany({
            where: { is_deleted: false }
        });
    }

    async findById(id: string): Promise<DetallePago | null> {
        return prisma.detallePago.findUnique({
            where: { detalle_pago_id: id, is_deleted: false }
        });
    }

    async create(data: DetallePago): Promise<void> {
        await prisma.detallePago.create({
            data: {
                detalle_pago_id: data.detalle_pago_id,
                pago_cliente_id: data.pago_cliente_id,
                tipo_pago_id: data.tipo_pago_id,
                moneda_id: data.moneda_id,
                cuenta_id: data.cuenta_id ?? null,
                cantidad: data.cantidad,
                tipo_cambio_id: data.tipo_cambio_id ?? null,
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

    async update(id: string, data: Partial<DetallePago>): Promise<void> {
        await prisma.detallePago.update({
            where: { detalle_pago_id: id },
            data: {
                pago_cliente_id: data.pago_cliente_id,
                tipo_pago_id: data.tipo_pago_id,
                moneda_id: data.moneda_id,
                cuenta_id: data.cuenta_id ?? undefined,
                cantidad: data.cantidad,
                tipo_cambio_id: data.tipo_cambio_id,
                gym_id: data.gym_id ?? undefined,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.detallePago.update({
            where: { detalle_pago_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
