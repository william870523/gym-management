import { randomUUID } from "crypto";
import type { CreateReferenciaDTO } from "../../dtos/ReferenciaDTO";
import type { Referencia } from "../../../domain/entities/Referencia";
import type { ReferenciaRepository } from "../../../domain/repositories/ReferenciaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class CreateReferenciaUseCase {
    constructor(
        private readonly referenciaRepository: ReferenciaRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(dto: CreateReferenciaDTO): Promise<Referencia> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const newReferencia: Referencia = {
                referencia_id: randomUUID(),
                nombre_referencia: dto.nombre_referencia,
                version: 1,
                created_at: new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            };

            await this.referenciaRepository.withTransaction(tx).create(newReferencia);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "referencia",
                operacion: "INSERT",
                entidadId: newReferencia.referencia_id,
                gymId: null, // Global
                deviceId: "WEB_ADMIN",
                payload: newReferencia as any
            }, tx);

            return newReferencia;
        });
    }
}

