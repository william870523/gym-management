import type { TipoCambio } from "../../domain/entities/TipoCambio";
import type { TipoCambioRepository } from "../../domain/repositories/TipoCambioRepository";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";

export class PrismaTipoCambioRepository implements TipoCambioRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaTipoCambioRepository {
    return new PrismaTipoCambioRepository(tx);
  }

    async upsertTipoCambio(data: TipoCambio): Promise<void> {
        await this.client.tipoCambio.upsert({
            where: { tipo_cambio_id: data.tipo_cambio_id },
            create: {
                tipo_cambio_id: data.tipo_cambio_id,
                moneda_id_base: data.moneda_id_base,
                moneda_id_target: data.moneda_id_target,
                exchange_rate: data.exchange_rate,
                recargos_json: data.recargos_json ?? null,
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
                recargos_json: data.recargos_json ?? null,
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
        return (this.client.tipoCambio.findMany({
            where: { is_deleted: false },
            include: {
                moneda_base: true,
                moneda_target: true
            }
        }) as any);
    }

    async findById(id: string): Promise<TipoCambio | null> {
        return (this.client.tipoCambio.findUnique({
            where: { tipo_cambio_id: id, is_deleted: false },
            include: {
                moneda_base: true,
                moneda_target: true
            }
        }) as any);
    }

    async create(data: TipoCambio): Promise<void> {
        await this.client.tipoCambio.create({
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
        await this.client.tipoCambio.update({
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
        await this.client.tipoCambio.update({
            where: { tipo_cambio_id: id },
            data: {
                is_deleted: true,
                deleted_at: new Date(),
                updated_at: new Date()
            }
        });
    }
}
