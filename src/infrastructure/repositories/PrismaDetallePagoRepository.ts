import type { DetallePago } from "../../domain/entities/DetallePago";
import type { DetallePagoRepository } from "../../domain/repositories/DetallePagoRepository";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import {
    softDeleteGymScopedSyncRecord,
    upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";
import { assertGymScopedReference } from "./gym-scoped-reference";

export class PrismaDetallePagoRepository implements DetallePagoRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaDetallePagoRepository {
    return new PrismaDetallePagoRepository(tx);
  }

  // Unidad 01: usa una transacción propia cuando `client` es el prisma raíz;
  // si ya es el cliente de una transacción (upload), la reutiliza en vez de
  // anidar otra —Prisma no soporta transacciones anidadas y un TransactionClient
  // no expone `$transaction`.
  private runInClient<T>(work: (c: any) => Promise<T>): Promise<T> {
    return typeof this.client.$transaction === "function"
      ? this.client.$transaction(work)
      : work(this.client);
  }

    async upsertDetallePago(data: DetallePago): Promise<void> {
        const now = trustedClock.nowUtc();
        if (!data.gym_id) throw new Error("El evento de detalle no tiene gimnasio autenticado.");
        await this.runInClient(async (tx) => {
            await Promise.all([
                assertGymScopedReference({
                    delegate: tx.pagoCliente,
                    entity: "pago",
                    pk: "pago_cliente_id",
                    id: data.pago_cliente_id,
                    gymId: data.gym_id!,
                }),
                data.cuenta_id
                    ? assertGymScopedReference({
                        delegate: tx.cuenta,
                        entity: "cuenta",
                        pk: "cuenta_id",
                        id: data.cuenta_id,
                        gymId: data.gym_id!,
                    })
                    : Promise.resolve(),
            ]);
            await upsertGymScopedSyncRecord({
                delegate: tx.detallePago,
                entity: "detalle_pago",
                pk: "detalle_pago_id",
                id: data.detalle_pago_id,
                gymId: data.gym_id,
                create: {
                    detalle_pago_id: data.detalle_pago_id,
                    pago_cliente_id: data.pago_cliente_id,
                    tipo_pago_id: data.tipo_pago_id,
                    moneda_id: data.moneda_id,
                    cuenta_id: data.cuenta_id ?? null,
                    cantidad: data.cantidad,
                    tipo_cambio_id: data.tipo_cambio_id ?? null,
                    recargo_metodo_base: data.recargo_metodo_base == null ? null : String(data.recargo_metodo_base),
                    recargo_metodo_pct: data.recargo_metodo_pct ?? null,
                    recargo_metodo_importe: data.recargo_metodo_importe ?? null,
                    recargo_metodo_total: data.recargo_metodo_total ?? null,
                    recargo_metodo_politica: data.recargo_metodo_politica ?? null,
                    recargo_metodo_tasa_version: data.recargo_metodo_tasa_version ?? null,
                    recargo_mora_modo_snapshot: data.recargo_mora_modo_snapshot ?? null,
                    recargo_mora_dias_atraso: data.recargo_mora_dias_atraso ?? null,
                    recargo_mora_base: data.recargo_mora_base ?? null,
                    recargo_mora_importe: data.recargo_mora_importe ?? null,
                    recargo_mora_plan_valor: data.recargo_mora_plan_valor ?? null,
                    recargo_mora_plan_tope: data.recargo_mora_plan_tope ?? null,
                    gym_id: data.gym_id,
                    source_device: data.source_device ?? null,
                    version: data.version,
                    created_at: data.created_at ?? now,
                    updated_at: now,
                    deleted_at: null,
                    is_deleted: false,
                },
                update: {
                    pago_cliente_id: data.pago_cliente_id,
                    tipo_pago_id: data.tipo_pago_id,
                    moneda_id: data.moneda_id,
                    cuenta_id: data.cuenta_id ?? null,
                    cantidad: data.cantidad,
                    tipo_cambio_id: data.tipo_cambio_id ?? null,
                    recargo_metodo_base: data.recargo_metodo_base == null ? null : String(data.recargo_metodo_base),
                    recargo_metodo_pct: data.recargo_metodo_pct ?? null,
                    recargo_metodo_importe: data.recargo_metodo_importe ?? null,
                    recargo_metodo_total: data.recargo_metodo_total ?? null,
                    recargo_metodo_politica: data.recargo_metodo_politica ?? null,
                    recargo_metodo_tasa_version: data.recargo_metodo_tasa_version ?? null,
                    recargo_mora_modo_snapshot: data.recargo_mora_modo_snapshot ?? null,
                    recargo_mora_dias_atraso: data.recargo_mora_dias_atraso ?? null,
                    recargo_mora_base: data.recargo_mora_base ?? null,
                    recargo_mora_importe: data.recargo_mora_importe ?? null,
                    recargo_mora_plan_valor: data.recargo_mora_plan_valor ?? null,
                    recargo_mora_plan_tope: data.recargo_mora_plan_tope ?? null,
                    gym_id: data.gym_id,
                    source_device: data.source_device ?? null,
                    version: data.version,
                    updated_at: now,
                    deleted_at: null,
                    is_deleted: false,
                },
            });
        });
    }

    async findAll(gymId: string): Promise<DetallePago[]> {
        return this.client.detallePago.findMany({
            where: { gym_id: gymId, is_deleted: false }
        });
    }

    async findById(id: string, gymId: string): Promise<DetallePago | null> {
        return this.client.detallePago.findFirst({
            where: { detalle_pago_id: id, gym_id: gymId, is_deleted: false }
        });
    }

    async create(data: DetallePago): Promise<void> {
        if (!data.gym_id) throw new Error("El token debe identificar el gimnasio del detalle.");
        const payment = await this.client.pagoCliente.findFirst({
            where: {
                pago_cliente_id: data.pago_cliente_id,
                gym_id: data.gym_id,
                is_deleted: false,
            },
            select: { pago_cliente_id: true },
        });
        if (!payment) throw new Error("El pago no pertenece al gimnasio autenticado.");
        if (data.cuenta_id) {
            await assertGymScopedReference({
                delegate: this.client.cuenta,
                entity: "cuenta",
                pk: "cuenta_id",
                id: data.cuenta_id,
                gymId: data.gym_id,
            });
        }
        const now = trustedClock.nowUtc();
        await this.client.detallePago.create({
            data: {
                detalle_pago_id: data.detalle_pago_id,
                pago_cliente_id: data.pago_cliente_id,
                tipo_pago_id: data.tipo_pago_id,
                moneda_id: data.moneda_id,
                cuenta_id: data.cuenta_id ?? null,
                cantidad: data.cantidad,
                tipo_cambio_id: data.tipo_cambio_id ?? null,
                recargo_metodo_base: data.recargo_metodo_base == null ? null : String(data.recargo_metodo_base),
                recargo_metodo_pct: data.recargo_metodo_pct ?? null,
                recargo_metodo_importe: data.recargo_metodo_importe ?? null,
                recargo_metodo_total: data.recargo_metodo_total ?? null,
                recargo_metodo_politica: data.recargo_metodo_politica ?? null,
                recargo_metodo_tasa_version: data.recargo_metodo_tasa_version ?? null,
                recargo_mora_modo_snapshot: data.recargo_mora_modo_snapshot ?? null,
                recargo_mora_dias_atraso: data.recargo_mora_dias_atraso ?? null,
                recargo_mora_base: data.recargo_mora_base ?? null,
                recargo_mora_importe: data.recargo_mora_importe ?? null,
                recargo_mora_plan_valor: data.recargo_mora_plan_valor ?? null,
                recargo_mora_plan_tope: data.recargo_mora_plan_tope ?? null,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, gymId: string, data: Partial<DetallePago>): Promise<void> {
        await this.runInClient(async (tx) => {
            if (data.pago_cliente_id) {
                const payment = await tx.pagoCliente.findFirst({
                    where: {
                        pago_cliente_id: data.pago_cliente_id,
                        gym_id: gymId,
                        is_deleted: false,
                    },
                    select: { pago_cliente_id: true },
                });
                if (!payment) throw new Error("El pago no pertenece al gimnasio autenticado.");
            }
            if (data.cuenta_id) {
                await assertGymScopedReference({
                    delegate: tx.cuenta,
                    entity: "cuenta",
                    pk: "cuenta_id",
                    id: data.cuenta_id,
                    gymId,
                });
            }
            const result = await tx.detallePago.updateMany({
                where: { detalle_pago_id: id, gym_id: gymId, is_deleted: false },
                data: {
                pago_cliente_id: data.pago_cliente_id,
                tipo_pago_id: data.tipo_pago_id,
                moneda_id: data.moneda_id,
                cuenta_id: data.cuenta_id ?? undefined,
                cantidad: data.cantidad,
                tipo_cambio_id: data.tipo_cambio_id,
                recargo_metodo_base: data.recargo_metodo_base == null ? data.recargo_metodo_base : String(data.recargo_metodo_base),
                recargo_metodo_pct: data.recargo_metodo_pct,
                recargo_metodo_importe: data.recargo_metodo_importe,
                recargo_metodo_total: data.recargo_metodo_total,
                recargo_metodo_politica: data.recargo_metodo_politica,
                recargo_metodo_tasa_version: data.recargo_metodo_tasa_version,
                recargo_mora_modo_snapshot: data.recargo_mora_modo_snapshot,
                recargo_mora_dias_atraso: data.recargo_mora_dias_atraso,
                recargo_mora_base: data.recargo_mora_base,
                recargo_mora_importe: data.recargo_mora_importe,
                recargo_mora_plan_valor: data.recargo_mora_plan_valor,
                recargo_mora_plan_tope: data.recargo_mora_plan_tope,
                version: { increment: 1 },
                updated_at: trustedClock.nowUtc()
                },
            });
            if (result.count !== 1) throw new Error("DetallePago not found");
        });
    }

    async softDelete(id: string, gymId: string): Promise<void> {
        const now = trustedClock.nowUtc();
        await softDeleteGymScopedSyncRecord({
            delegate: this.client.detallePago,
            entity: "detalle_pago",
            pk: "detalle_pago_id",
            id,
            gymId,
            now,
        });
    }
}
