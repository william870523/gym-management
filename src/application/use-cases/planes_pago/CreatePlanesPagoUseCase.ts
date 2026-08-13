import { randomUUID } from "crypto";
import type { CreatePlanesPagoDTO } from "../../dtos/PlanesPagoDTO";
import type { PlanesPago } from "../../../domain/entities/PlanesPago";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { recargoMoraColumns } from "../../../domain/recargo-mora-policy";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class CreatePlanesPagoUseCase {
    constructor(
        private readonly planesPagoRepository: PlanesPagoRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(dto: CreatePlanesPagoDTO, gymId: string): Promise<PlanesPago> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const authenticatedGymId = gymId.trim();
            if (!authenticatedGymId) {
                throw new Error("Gym scope required");
            }
            const now = trustedClock.nowUtc();
            const newPlanesPago: PlanesPago = {
                id_planes_pago: randomUUID(),
                nombre_plan_pago: dto.nombre_plan_pago ?? null,
                importe_plan_pago: dto.importe_plan_pago,
                duracion_plan_pago: dto.duracion_plan_pago,
                activo: dto.activo ?? true,
                moneda_id: dto.moneda_id,
                incluye_entrenador: dto.incluye_entrenador ?? false,
                comision_entrenador_tipo: dto.comision_entrenador_tipo ?? "NONE",
                comision_entrenador_valor: dto.comision_entrenador_valor ?? null,
                acepta_cuotas: dto.acepta_cuotas ?? false,
                codigo: dto.codigo ?? null,
                precio_viejo_excepcion: dto.precio_viejo_excepcion ?? null,
                // Recargo por mora validado en el dominio (docs/RECARGO_MORA.md).
                ...recargoMoraColumns({
                    modo: dto.recargo_mora_modo,
                    valor: dto.recargo_mora_valor,
                    tope: dto.recargo_mora_tope,
                    activo: dto.recargo_mora_activo,
                }),
                gym_id: authenticatedGymId,
                source_device: "WEB_ADMIN",
                version: 1,
                created_at: now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            };

            await this.planesPagoRepository.withTransaction(tx).create(newPlanesPago, authenticatedGymId);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "planes_pago",
                operacion: "INSERT",
                entidadId: newPlanesPago.id_planes_pago,
                gymId: authenticatedGymId,
                deviceId: "WEB_ADMIN",
                payload: newPlanesPago as any
            }, tx);

            return newPlanesPago;
        });
    }
}

