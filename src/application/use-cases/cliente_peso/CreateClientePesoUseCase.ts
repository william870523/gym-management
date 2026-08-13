import { randomUUID } from "crypto";
import type { CreateClientePesoDTO } from "../../dtos/ClientePesoDTO";
import type { ClientePeso } from "../../../domain/entities/ClientePeso";
import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class CreateClientePesoUseCase {
    constructor(
        private readonly clientePesoRepository: ClientePesoRepository,
        // El evento vivía en el controlador, escrito con el prisma global
        // después de que el caso de uso hubiera guardado la fila. Se trae aquí,
        // que es donde lo tienen las otras once entidades, y sobre todo se mete
        // en la misma transacción que la escritura.
        private readonly syncLogRepository?: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(dto: CreateClientePesoDTO, gymId: string): Promise<ClientePeso> {
        const occurredAt = trustedClock.nowUtc();
        const newClientePeso: ClientePeso = {
            cliente_peso_id: dto.cliente_peso_id ?? randomUUID(),
            ci: dto.ci,
            fecha: occurredAt,
            peso: dto.peso,
            gym_id: gymId,
            source_device: null,
            version: 1,
            created_at: occurredAt,
            updated_at: occurredAt,
            deleted_at: null,
            is_deleted: false
        };

        // El repositorio de sync_log es opcional para no romper a quien ya
        // construye este caso de uso con un solo argumento; si no llega, se
        // escribe la fila igual y quien la registre seguirá siendo el llamador.
        if (!this.syncLogRepository) {
            await this.clientePesoRepository.create(newClientePeso);
            return newClientePeso;
        }

        // La fila y su evento, en la MISMA transacción.
        await this.enTransaccion(async (tx) => {
            await this.clientePesoRepository.withTransaction(tx).create(newClientePeso);
            await this.syncLogRepository!.register({
                eventId: randomUUID(),
                entidad: "cliente_peso",
                operacion: "INSERT",
                entidadId: newClientePeso.cliente_peso_id,
                gymId: newClientePeso.gym_id ?? null,
                deviceId: "WEB_ADMIN",
                payload: newClientePeso as any,
            }, tx);
        });

        return newClientePeso;
    }
}
