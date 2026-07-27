import type { PlanesPago } from "../../domain/entities/PlanesPago";
import type { PlanesPagoRepository } from "../../domain/repositories/PlanesPagoRepository";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";
import { delegateFor, type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import {
    softDeleteGymScopedSyncRecord,
    upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";

export class PrismaPlanesPagoRepository implements PlanesPagoRepository {
    constructor(private readonly planDelegate: any = prisma.planesPago) {}

    withTransaction(tx: SyncTransactionContext): PrismaPlanesPagoRepository {
        return new PrismaPlanesPagoRepository(delegateFor(tx, "planesPago", this.planDelegate));
    }

    async upsertPlanesPago(data: PlanesPago): Promise<void> {
        const now = trustedClock.nowUtc();
        await upsertGymScopedSyncRecord({
            delegate: this.planDelegate,
            entity: "planes_pago",
            pk: "id_planes_pago",
            id: data.id_planes_pago,
            gymId: data.gym_id,
            create: {
                id_planes_pago: data.id_planes_pago,
                nombre_plan_pago: data.nombre_plan_pago,
                importe_plan_pago: data.importe_plan_pago,
                duracion_plan_pago: data.duracion_plan_pago,
                activo: data.activo,
                moneda_id: data.moneda_id,
                incluye_entrenador: data.incluye_entrenador ?? false,
                comision_entrenador_tipo: data.comision_entrenador_tipo ?? "NONE",
                comision_entrenador_valor: data.comision_entrenador_valor ?? null,
                acepta_cuotas: data.acepta_cuotas ?? false,
                codigo: data.codigo ?? null,
                precio_viejo_excepcion: data.precio_viejo_excepcion ?? null,
                recargo_mora_modo: data.recargo_mora_modo ?? null,
                recargo_mora_valor: data.recargo_mora_valor ?? null,
                recargo_mora_tope: data.recargo_mora_tope ?? null,
                recargo_mora_activo: data.recargo_mora_activo ?? false,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            },
            update: {
                nombre_plan_pago: data.nombre_plan_pago,
                importe_plan_pago: data.importe_plan_pago,
                duracion_plan_pago: data.duracion_plan_pago,
                activo: data.activo,
                moneda_id: data.moneda_id,
                incluye_entrenador: data.incluye_entrenador ?? false,
                comision_entrenador_tipo: data.comision_entrenador_tipo ?? "NONE",
                comision_entrenador_valor: data.comision_entrenador_valor ?? null,
                acepta_cuotas: data.acepta_cuotas ?? false,
                codigo: data.codigo ?? null,
                precio_viejo_excepcion: data.precio_viejo_excepcion ?? null,
                recargo_mora_modo: data.recargo_mora_modo ?? null,
                recargo_mora_valor: data.recargo_mora_valor ?? null,
                recargo_mora_tope: data.recargo_mora_tope ?? null,
                recargo_mora_activo: data.recargo_mora_activo ?? false,
                gym_id: data.gym_id ?? null,
                source_device: data.source_device ?? null,
                version: data.version,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async findAll(gymId: string): Promise<PlanesPago[]> {
        return this.planDelegate.findMany({
            where: { gym_id: this.requireGymId(gymId), is_deleted: false }
        });
    }

    async findById(id: string, gymId: string): Promise<PlanesPago | null> {
        return this.planDelegate.findFirst({
            where: {
                id_planes_pago: id,
                gym_id: this.requireGymId(gymId),
                is_deleted: false,
            }
        });
    }

    async create(data: PlanesPago, gymId: string): Promise<void> {
        const authenticatedGymId = this.requireGymId(gymId);
        const now = trustedClock.nowUtc();
        await this.planDelegate.create({
            data: {
                id_planes_pago: data.id_planes_pago,
                nombre_plan_pago: data.nombre_plan_pago,
                importe_plan_pago: data.importe_plan_pago,
                duracion_plan_pago: data.duracion_plan_pago,
                activo: data.activo,
                moneda_id: data.moneda_id,
                incluye_entrenador: data.incluye_entrenador ?? false,
                comision_entrenador_tipo: data.comision_entrenador_tipo ?? "NONE",
                comision_entrenador_valor: data.comision_entrenador_valor ?? null,
                acepta_cuotas: data.acepta_cuotas ?? false,
                codigo: data.codigo ?? null,
                precio_viejo_excepcion: data.precio_viejo_excepcion ?? null,
                recargo_mora_modo: data.recargo_mora_modo ?? null,
                recargo_mora_valor: data.recargo_mora_valor ?? null,
                recargo_mora_tope: data.recargo_mora_tope ?? null,
                recargo_mora_activo: data.recargo_mora_activo ?? false,
                gym_id: authenticatedGymId,
                source_device: data.source_device ?? null,
                version: data.version,
                created_at: data.created_at ?? now,
                updated_at: data.updated_at ?? now,
                deleted_at: null,
                is_deleted: false
            }
        });
    }

    async update(id: string, gymId: string, data: Partial<PlanesPago>): Promise<void> {
        const updated = await this.planDelegate.updateMany({
            where: {
                id_planes_pago: id,
                gym_id: this.requireGymId(gymId),
                is_deleted: false,
            },
            data: {
                nombre_plan_pago: data.nombre_plan_pago,
                importe_plan_pago: data.importe_plan_pago,
                duracion_plan_pago: data.duracion_plan_pago,
                activo: data.activo,
                moneda_id: data.moneda_id,
                incluye_entrenador: data.incluye_entrenador,
                comision_entrenador_tipo: data.comision_entrenador_tipo,
                comision_entrenador_valor: data.comision_entrenador_valor,
                acepta_cuotas: data.acepta_cuotas,
                codigo: data.codigo,
                precio_viejo_excepcion: data.precio_viejo_excepcion,
                recargo_mora_modo: data.recargo_mora_modo,
                recargo_mora_valor: data.recargo_mora_valor,
                recargo_mora_tope: data.recargo_mora_tope,
                recargo_mora_activo: data.recargo_mora_activo,
                version: data.version ?? { increment: 1 },
                updated_at: data.updated_at ?? trustedClock.nowUtc()
            }
        });
        if (updated.count !== 1) {
            throw new Error("PlanesPago not found");
        }
    }

    async softDelete(id: string, gymId: string): Promise<void> {
        await softDeleteGymScopedSyncRecord({
            delegate: this.planDelegate,
            entity: "planes_pago",
            pk: "id_planes_pago",
            id,
            gymId: this.requireGymId(gymId),
            now: trustedClock.nowUtc(),
        });
    }

    private requireGymId(gymId: string) {
        const normalized = gymId.trim();
        if (!normalized) throw new Error("Gym scope required");
        return normalized;
    }
}
