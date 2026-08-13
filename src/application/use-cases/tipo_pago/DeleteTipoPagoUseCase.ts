import { randomUUID } from "crypto";
import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class DeleteTipoPagoUseCase {
    constructor(
        private readonly tipoPagoRepository: TipoPagoRepository,
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
            const existing = await this.tipoPagoRepository.withTransaction(tx).findById(id);
            if (!existing) {
                throw new Error("TipoPago not found");
            }

            await this.tipoPagoRepository.withTransaction(tx).softDelete(id);

            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "tipo_pago",
                operacion: "DELETE",
                entidadId: id,
                gymId: null,
                deviceId: "WEB_ADMIN",
                payload: { tipo_pago_id: id }
            }, tx);
        });
    }
}

