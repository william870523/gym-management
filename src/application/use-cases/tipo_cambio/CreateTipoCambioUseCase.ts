import { randomUUID } from "crypto";
import type { CreateTipoCambioDTO } from "../../dtos/TipoCambioDTO";
import type { TipoCambio } from "../../../domain/entities/TipoCambio";
import type { TipoCambioRepository } from "../../../domain/repositories/TipoCambioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class CreateTipoCambioUseCase {
    constructor(
        private readonly tipoCambioRepository: TipoCambioRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(dto: CreateTipoCambioDTO): Promise<TipoCambio> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            if (dto.moneda_id_base === dto.moneda_id_target) {
                throw new Error("Same-currency exchange rates are implicit 1:1 and must not be created");
            }

            const newTipoCambio: TipoCambio = {
                tipo_cambio_id: randomUUID(),
                moneda_id_base: dto.moneda_id_base,
                moneda_id_target: dto.moneda_id_target,
                exchange_rate: dto.exchange_rate,
                fecha_inicio: new Date(dto.fecha_inicio),
                fecha_expiracion: dto.fecha_expiracion ? new Date(dto.fecha_expiracion) : null,
                activo: dto.activo ?? true,
                version: 1,
                created_at: new Date(),
                updated_at: new Date(),
                deleted_at: null,
                is_deleted: false
            };

            await this.tipoCambioRepository.withTransaction(tx).create(newTipoCambio);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "tipo_cambio",
                operacion: "INSERT",
                entidadId: newTipoCambio.tipo_cambio_id,
                gymId: null, // Global or shared logic depends on GymId presence, usually global for catalogs
                deviceId: "WEB_ADMIN",
                payload: newTipoCambio as any
            }, tx);


            return newTipoCambio;
        });
    }
}

