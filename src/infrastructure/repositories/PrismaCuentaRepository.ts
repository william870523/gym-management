import type { Cuenta } from "../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../domain/repositories/CuentaRepository";
import { prisma } from "../db/prismaClient";

export class PrismaCuentaRepository implements CuentaRepository {
    async upsertCuenta(data: Cuenta): Promise<void> {
        await prisma.cuenta.upsert({
            where: { cuenta_id: data.cuenta_id },
            create: {
                cuenta_id: data.cuenta_id,
                nombre_cuenta: data.nombre_cuenta,
                moneda_id: data.moneda_id,
                tipo_pago_id: data.tipo_pago_id || null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            },
            update: {
                nombre_cuenta: data.nombre_cuenta,
                moneda_id: data.moneda_id,
                tipo_pago_id: data.tipo_pago_id || null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(): Promise<Cuenta[]> {
        const result = await prisma.cuenta.findMany({
            where: { is_deleted: false },
            include: { moneda: true }
        });

        // Convert moneda buffer to base64 for JSON serialization compatibility with existing utils if needed, 
        // or just return as is and let the controller handle it.
        // The previous local controller returns it directly. 
        // However, `findAll` return type is `Promise<Cuenta[]>`.
        // Prisma returns binary fields as Buffer/Uint8Array. 
        // If we want to be safe, we map it.
        return result.map(c => ({
            ...c,
            moneda: c.moneda ? {
                ...c.moneda,
                imagen: c.moneda.imagen ? Buffer.from(c.moneda.imagen).toString('base64') : null
            } : null
        }));
    }

    async findById(id: string): Promise<Cuenta | null> {
        return prisma.cuenta.findUnique({
            where: { cuenta_id: id, is_deleted: false }
        });
    }

    async create(data: Cuenta): Promise<void> {
        await prisma.cuenta.create({
            data: {
                cuenta_id: data.cuenta_id,
                nombre_cuenta: data.nombre_cuenta,
                moneda_id: data.moneda_id,
                tipo_pago_id: data.tipo_pago_id || null,
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

    async update(id: string, data: Partial<Cuenta>): Promise<void> {
        await prisma.cuenta.update({
            where: { cuenta_id: id },
            data: {
                nombre_cuenta: data.nombre_cuenta,
                moneda_id: data.moneda_id,
                tipo_pago_id: data.tipo_pago_id || null,
                gym_id: data.gym_id ?? null,
                version: { increment: 1 },
                updated_at: new Date()
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.cuenta.update({
            where: { cuenta_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
