import type { PagoCliente } from "../../domain/entities/PagoCliente";
import type { PagoClienteRepository } from "../../domain/repositories/PagoClienteRepository";
import { prisma } from "../db/prismaClient";

export class PrismaPagoClienteRepository implements PagoClienteRepository {
    async upsertPagoCliente(data: PagoCliente): Promise<void> {
        await prisma.pagoCliente.upsert({
            where: { pago_cliente_id: data.pago_cliente_id },
            create: {
                pago_cliente_id: data.pago_cliente_id,
                ci: data.ci,
                fecha: data.fecha,
                monto_total: data.monto_total,
                id_entrenador: data.id_entrenador ?? null,
                id_planes_pago: data.id_planes_pago,
                moneda_id: data.moneda_id,
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
                monto_total: data.monto_total,
                id_entrenador: data.id_entrenador ?? null,
                id_planes_pago: data.id_planes_pago,
                moneda_id: data.moneda_id,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<PagoCliente[]> {
        return prisma.pagoCliente.findMany({
            where: { is_deleted: false }
        });
    }

    async findById(id: string): Promise<PagoCliente | null> {
        return prisma.pagoCliente.findUnique({
            where: { pago_cliente_id: id, is_deleted: false }
        });
    }

    async create(data: PagoCliente): Promise<void> {
        await prisma.pagoCliente.create({
            data: {
                pago_cliente_id: data.pago_cliente_id,
                ci: data.ci,
                fecha: data.fecha,
                monto_total: data.monto_total,
                id_entrenador: data.id_entrenador ?? null,
                id_planes_pago: data.id_planes_pago,
                moneda_id: data.moneda_id,
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

    async update(id: string, data: Partial<PagoCliente>): Promise<void> {
        await prisma.pagoCliente.update({
            where: { pago_cliente_id: id },
            data: {
                ci: data.ci,
                fecha: data.fecha,
                monto_total: data.monto_total,
                id_entrenador: data.id_entrenador ?? undefined,
                id_planes_pago: data.id_planes_pago,
                moneda_id: data.moneda_id,
                gym_id: data.gym_id ?? undefined,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.pagoCliente.update({
            where: { pago_cliente_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
