import { randomUUID } from "crypto";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class DeleteHorarioUseCase {
    constructor(
        private readonly horarioRepository: HorarioRepository,
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
            const existing = await this.horarioRepository.withTransaction(tx).findById(id, gymId);
            if (!existing) {
                throw new Error("Horario not found");
            }

            await this.horarioRepository.withTransaction(tx).softDelete(id, gymId);

            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "horario",
                operacion: "DELETE",
                entidadId: id,
                gymId,
                deviceId: "WEB_ADMIN",
                payload: { horario_id: id }
            }, tx);
        });
    }
}

