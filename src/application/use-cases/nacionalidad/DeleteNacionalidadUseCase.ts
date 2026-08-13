import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { randomUUID } from "crypto";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";


export class DeleteNacionalidadUseCase {
    constructor(
        private readonly nacionalidadRepository: NacionalidadRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }


    async execute(id: string): Promise<void> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const existing = await this.nacionalidadRepository.withTransaction(tx).findById(id);
            if (!existing) {
                throw new Error("Nacionalidad not found");
            }

            await this.nacionalidadRepository.withTransaction(tx).softDelete(id);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "nacionalidad",
                operacion: "DELETE",
                entidadId: id,
                gymId: null, // Global entity
                deviceId: "WEB_ADMIN",
                payload: { nacionalidad_id: id, is_deleted: true }
            }, tx);
        });
    }
}

