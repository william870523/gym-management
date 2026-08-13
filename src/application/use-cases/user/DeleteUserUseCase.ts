import { v4 as uuidv4 } from "uuid";
import { UserRepository } from "../../../domain/repositories/UserRepository";
import { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class DeleteUserUseCase {
    constructor(
        private readonly userRepository: UserRepository,
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
            const existing = await this.userRepository.withTransaction(tx).findById(id, gymId);
            if (!existing) {
                throw new Error("User not found");
            }

            await this.userRepository.withTransaction(tx).softDelete(id, gymId);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: uuidv4(),
                entidad: "user",
                operacion: "DELETE",
                entidadId: id,
                gymId,
                deviceId: "WEB_ADMIN",
                payload: { user_id: id }
            }, tx);
        });
    }
}
