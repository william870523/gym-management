import { randomUUID } from "crypto";
import type { CreateTipoPagoDTO } from "../../dtos/TipoPagoDTO";
import type { TipoPago } from "../../../domain/entities/TipoPago";
import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class CreateTipoPagoUseCase {
    constructor(
        private readonly tipoPagoRepository: TipoPagoRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(dto: CreateTipoPagoDTO): Promise<TipoPago> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const newTipoPago: TipoPago = {
                tipo_pago_id: randomUUID(),
                nombre_tipo_pago: dto.nombre_tipo_pago,
                codigo: dto.codigo,
                activo: dto.activo ?? true,
                version: 1,
                created_at: new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            };

            await this.tipoPagoRepository.withTransaction(tx).create(newTipoPago);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "tipo_pago",
                operacion: "INSERT",
                entidadId: newTipoPago.tipo_pago_id,
                gymId: null,
                deviceId: "WEB_ADMIN",
                payload: newTipoPago as any
            }, tx);

            return newTipoPago;
        });
    }
}

