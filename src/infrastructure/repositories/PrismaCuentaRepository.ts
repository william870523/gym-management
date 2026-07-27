import type { Cuenta } from "../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../domain/repositories/CuentaRepository";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import {
    softDeleteGymScopedSyncRecord,
    upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";

export class PrismaCuentaRepository implements CuentaRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaCuentaRepository {
    return new PrismaCuentaRepository(tx);
  }

    async upsertCuenta(data: Cuenta): Promise<void> {
        const now = trustedClock.nowUtc();
        await upsertGymScopedSyncRecord({
            delegate: this.client.cuenta,
            entity: "cuenta",
            pk: "cuenta_id",
            id: data.cuenta_id,
            gymId: data.gym_id,
            create: {
                cuenta_id: data.cuenta_id,
                nombre_cuenta: data.nombre_cuenta,
                moneda_id: data.moneda_id,
                tipo_pago_id: data.tipo_pago_id || null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: now,
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
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(gymId: string): Promise<Cuenta[]> {
        const result = await this.client.cuenta.findMany({
            where: { gym_id: gymId, is_deleted: false },
            include: { moneda: true }
        });

        // Convert moneda buffer to base64 for JSON serialization compatibility with existing utils if needed, 
        // or just return as is and let the controller handle it.
        // The previous local controller returns it directly. 
        // However, `findAll` return type is `Promise<Cuenta[]>`.
        // Prisma returns binary fields as Buffer/Uint8Array. 
        // If we want to be safe, we map it.
        return result.map((c: any) => ({
            ...c,
            moneda: c.moneda ? {
                ...c.moneda,
                imagen: c.moneda.imagen ? Buffer.from(c.moneda.imagen).toString('base64') : null
            } : null
        }));
    }

    async findById(id: string, gymId: string): Promise<Cuenta | null> {
        return this.client.cuenta.findFirst({
            where: { cuenta_id: id, gym_id: gymId, is_deleted: false }
        });
    }

    async create(data: Cuenta, gymId: string): Promise<void> {
        const now = trustedClock.nowUtc();
        await this.client.cuenta.create({
            data: {
                cuenta_id: data.cuenta_id,
                nombre_cuenta: data.nombre_cuenta,
                moneda_id: data.moneda_id,
                tipo_pago_id: data.tipo_pago_id || null,
                gym_id: gymId,
                source_device: "WEB_ADMIN",
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, gymId: string, data: Partial<Cuenta>): Promise<void> {
        await this.client.cuenta.updateMany({
            where: { cuenta_id: id, gym_id: gymId, is_deleted: false },
            data: {
                nombre_cuenta: data.nombre_cuenta,
                moneda_id: data.moneda_id,
                tipo_pago_id: data.tipo_pago_id,
                version: { increment: 1 },
                updated_at: trustedClock.nowUtc()
            }
        });
    }

    async softDelete(id: string, gymId: string): Promise<void> {
        await softDeleteGymScopedSyncRecord({
            delegate: this.client.cuenta,
            entity: "cuenta",
            pk: "cuenta_id",
            id,
            gymId,
            now: trustedClock.nowUtc(),
        });
    }
}
