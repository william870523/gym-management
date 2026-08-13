import { randomUUID } from "crypto";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class DeleteEntrenadorUseCase {
    constructor(
        private readonly entrenadorRepository: EntrenadorRepository,
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
            const existing = await this.entrenadorRepository.withTransaction(tx).findById(id, gymId);
            if (!existing) {
                throw new Error("Entrenador not found");
            }

            await this.entrenadorRepository.withTransaction(tx).softDelete(id, gymId);

            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "entrenador",
                operacion: "DELETE",
                entidadId: id,
                gymId: existing.gym_id ?? null,
                deviceId: "WEB_ADMIN",
                payload: { id_entrenador: id }
            }, tx);
        });
    }
}

