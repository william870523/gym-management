import { randomUUID } from "crypto";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class DeleteClienteUseCase {
    constructor(
        private readonly clienteRepository: ClienteRepository,
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
            const existing = await this.clienteRepository.withTransaction(tx).findById(id, gymId);
            if (!existing) {
                throw new Error("Cliente not found");
            }

            await this.clienteRepository.withTransaction(tx).softDelete(id, gymId);

            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "cliente",
                operacion: "DELETE",
                entidadId: id,
                gymId: existing.gym_id ?? null,
                deviceId: "WEB_ADMIN",
                payload: { ci: id }
            }, tx);
        });
    }
}

