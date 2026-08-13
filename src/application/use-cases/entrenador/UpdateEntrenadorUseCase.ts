import { randomUUID } from "crypto";
import type { UpdateEntrenadorDTO } from "../../dtos/EntrenadorDTO";
import type { Entrenador } from "../../../domain/entities/Entrenador";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class UpdateEntrenadorUseCase {
    constructor(
        private readonly entrenadorRepository: EntrenadorRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(id: string, dto: UpdateEntrenadorDTO, gymId: string): Promise<void> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const existing = await this.entrenadorRepository.withTransaction(tx).findById(id, gymId);
            if (!existing) {
                throw new Error("Entrenador not found");
            }

            const updateData: Partial<Entrenador> = {
                ...dto,
                foto_entrenador: dto.foto_entrenador ? Buffer.from(dto.foto_entrenador, 'base64') : undefined,
                fecha_incio_entrenador: dto.fecha_incio_entrenador ? new Date(dto.fecha_incio_entrenador) : undefined,
                updated_at: trustedClock.nowUtc(),
                version: (existing.version ?? 0) + 1
            };

            await this.entrenadorRepository.withTransaction(tx).update(id, gymId, updateData);

            const updated = await this.entrenadorRepository.withTransaction(tx).findById(id, gymId);
            if (updated) {
                await this.syncLogRepository.register({
                    eventId: randomUUID(),
                    entidad: "entrenador",
                    operacion: "UPDATE",
                    entidadId: id,
                    gymId: updated.gym_id ?? null,
                    deviceId: "WEB_ADMIN",
                    payload: {
                        ...updated,
                        foto_entrenador: updated.foto_entrenador ? Buffer.from(updated.foto_entrenador).toString('base64') : null
                    } as any
                }, tx);
            }
        });
    }
}

