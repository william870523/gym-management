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
        return prisma.cuenta.findMany({
            where: { is_deleted: false }
        });
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
