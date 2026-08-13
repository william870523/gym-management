import { randomUUID } from "crypto";
import type { UpdateHorarioDTO } from "../../dtos/HorarioDTO";
import type { Horario } from "../../../domain/entities/Horario";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class UpdateHorarioUseCase {
    constructor(
        private readonly horarioRepository: HorarioRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(id: string, dto: UpdateHorarioDTO, gymId: string): Promise<void> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const existing = await this.horarioRepository.withTransaction(tx).findById(id, gymId);
            if (!existing) {
                throw new Error("Horario not found");
            }

            const updateData: Partial<Horario> = {
                ...dto,
                updated_at: trustedClock.nowUtc(),
                version: (existing.version ?? 0) + 1
            };

            await this.horarioRepository.withTransaction(tx).update(id, gymId, updateData);

            const updated = await this.horarioRepository.withTransaction(tx).findById(id, gymId);
            if (updated) {
                await this.syncLogRepository.register({
                    eventId: randomUUID(),
                    entidad: "horario",
                    operacion: "UPDATE",
                    entidadId: id,
                    gymId,
                    deviceId: "WEB_ADMIN",
                    payload: updated as any
                }, tx);
            }
        });
    }
}

