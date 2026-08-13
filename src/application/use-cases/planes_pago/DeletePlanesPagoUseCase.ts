import { randomUUID } from "crypto";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class DeletePlanesPagoUseCase {
    constructor(
        private readonly planesPagoRepository: PlanesPagoRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(id: string, gymId: string): Promise<void> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const existing = await this.planesPagoRepository.withTransaction(tx).findById(id, gymId);
            if (!existing) {
                throw new Error("PlanesPago not found");
            }

            await this.planesPagoRepository.withTransaction(tx).softDelete(id, gymId);

            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "planes_pago",
                operacion: "DELETE",
                entidadId: id,
                gymId,
                deviceId: "WEB_ADMIN",
                payload: { id_planes_pago: id }
            }, tx);
        });
    }
}

