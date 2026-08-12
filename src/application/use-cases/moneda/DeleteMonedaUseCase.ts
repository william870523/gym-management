import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { randomUUID } from "crypto";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class DeleteMonedaUseCase {
    constructor(
        private readonly monedaRepository: MonedaRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback
        // sin sustituir el módulo de Prisma para toda la suite.
        // El `as` es por los solapamientos de `$transaction` en Prisma, que
        // tiene una firma para arrays y otra para callbacks; la inferencia se
        // queda con la de arrays.
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(id: string): Promise<void> {
        const existing = await this.monedaRepository.findById(id);
        if (!existing) {
            throw new Error("Moneda not found");
        }

        // La baja y su evento, en la misma transacción: ver `CreateMonedaUseCase`.
        // Aquí la mitad perdida sería la peor de las tres: una moneda dada de
        // baja en el remoto y viva en el escritorio se sigue pudiendo cobrar.
        await this.enTransaccion(async (tx) => {
            await this.monedaRepository.withTransaction(tx).softDelete(id);
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "moneda",
                operacion: "DELETE",
                entidadId: id,
                gymId: null, // Global entity
                deviceId: "WEB_ADMIN",
                payload: { moneda_id: id, is_deleted: true }
            }, tx);
        });
    }
}
