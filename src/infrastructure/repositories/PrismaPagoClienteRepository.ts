import type { PagoCliente } from "../../domain/entities/PagoCliente";
import type { PagoClienteRepository } from "../../domain/repositories/PagoClienteRepository";
import type { DetallePago } from "../../domain/entities/DetallePago";
import { prisma } from "../db/prismaClient";
import { trustedClock } from "../../config/trusted-clock";

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
                created_at: data.created_at ?? trustedClock.nowUtc(),
                updated_at: trustedClock.nowUtc(),
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
                updated_at: trustedClock.nowUtc(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<PagoCliente[]> {
        const payments = await prisma.pagoCliente.findMany({
            orderBy: { fecha: "desc" },
            include: {
                cliente: {
                    select: {
                        nombres: true,
                        apellidos: true,
                    },
                },
                detalles: {
                    where: { is_deleted: false },
                },
            },
        });
        return payments.map((payment) => ({
            ...payment,
            clientName: `${payment.cliente.nombres ?? ""} ${payment.cliente.apellidos ?? ""}`.trim(),
            details: payment.detalles,
        })) as PagoCliente[];
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
                created_at: data.created_at ?? trustedClock.nowUtc(),
                updated_at: trustedClock.nowUtc(),
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
                updated_at: trustedClock.nowUtc()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.pagoCliente.update({
            where: { pago_cliente_id: id },
            data: {
                is_deleted: true,
                deleted_at: trustedClock.nowUtc(),
                updated_at: trustedClock.nowUtc()
            }
        });
    }

    async processPayment(
        pago: PagoCliente,
        detalles: DetallePago[],
        planDurationDays: number
    ): Promise<void> {
        await prisma.$transaction(async (tx) => {
            // 1. Create PagoCliente
            await tx.pagoCliente.create({
                data: {
                    pago_cliente_id: pago.pago_cliente_id,
                    ci: pago.ci,
                    fecha: pago.fecha,
                    monto_total: pago.monto_total,
                    id_entrenador: pago.id_entrenador ?? null,
                    id_planes_pago: pago.id_planes_pago,
                    moneda_id: pago.moneda_id,
                    gym_id: pago.gym_id ?? null,
                    source_device: pago.source_device ?? null,
                    version: pago.version,
                    created_at: pago.created_at ?? trustedClock.nowUtc(),
                    updated_at: trustedClock.nowUtc(),
                    deleted_at: null,
                    is_deleted: false
                }
            });

            // 2. Create DetallePago(s)
            if (detalles.length > 0) {
                // Map entities to Prisma input
                // Note: DetallePago entity fields match Prisma fields mostly
                await tx.detallePago.createMany({
                    data: detalles.map((d) => ({
                        detalle_pago_id: d.detalle_pago_id,
                        pago_cliente_id: pago.pago_cliente_id, // Link to created payment
                        tipo_pago_id: d.tipo_pago_id,
                        moneda_id: d.moneda_id,
                        cuenta_id: d.cuenta_id ?? null,
                        cantidad: d.cantidad,
                        tipo_cambio_id: d.tipo_cambio_id ?? null,
                        gym_id: d.gym_id ?? null,
                        source_device: d.source_device ?? null,
                        version: d.version,
                        created_at: d.created_at ?? trustedClock.nowUtc(),
                        updated_at: trustedClock.nowUtc(),
                        deleted_at: null,
                        is_deleted: false
                    }))
                });
            }

            // 3. Update Client (Activation & Expiration)
            const cliente = await tx.cliente.findUnique({
                where: { ci: pago.ci }
            });

            if (!cliente) {
                throw new Error(`Cliente con CI ${pago.ci} no encontrado al procesar pago.`);
            }

            const now = trustedClock.nowUtc();
            let baseDate = now;

            // If client has a future expiration date, extend from there
            if (cliente.fecha_fin && cliente.fecha_fin > now) {
                baseDate = cliente.fecha_fin;
            }

            // Calculate new expiration date
            const newFechaFin = new Date(baseDate);
            newFechaFin.setDate(newFechaFin.getDate() + planDurationDays);

            await tx.cliente.update({
                where: { ci: pago.ci },
                data: {
                    activo: true,
                    fecha_fin: newFechaFin,
                    updated_at: trustedClock.nowUtc()
                    // version: { increment: 1 } // If versioning is desired
                }
            });
        });
    }
}
