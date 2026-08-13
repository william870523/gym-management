import { randomUUID } from "crypto";
import type { CreateHorarioDTO } from "../../dtos/HorarioDTO";
import type { Horario } from "../../../domain/entities/Horario";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";
import { prisma } from "../../../infrastructure/db/prismaClient";
import type { SyncTransactionRunner } from "../sync/sync-transaction";

export class CreateHorarioUseCase {
    constructor(
        private readonly horarioRepository: HorarioRepository,
        private readonly syncLogRepository: SyncLogRepository,
        // Inyectable a propósito: es lo que hace verificable el rollback sin
        // sustituir el módulo de Prisma para toda la suite (mock.module en Bun
        // es global y tira las pruebas ajenas).
        private readonly enTransaccion: SyncTransactionRunner =
            ((fn: any) => prisma.$transaction(fn)) as SyncTransactionRunner,
    ) { }

    async execute(dto: CreateHorarioDTO, gymId: string): Promise<Horario> {
        // La fila y su evento, en la MISMA transacción. Sueltos, un fallo
        // entre los dos `await` deja la fila escrita sin evento que la
        // anuncie: el escritorio no se entera nunca y nada lo delata.
        return this.enTransaccion(async (tx) => {
            const authenticatedGymId = gymId.trim();
            if (!authenticatedGymId) throw new Error("Gym scope required");
            const now = trustedClock.nowUtc();
            const newHorario: Horario = {
                horario_id: randomUUID(),
                nombre_horario: dto.nombre_horario,
                hora_inicio: dto.hora_inicio,
                hora_fin: dto.hora_fin,
                gym_id: authenticatedGymId,
                source_device: "WEB_ADMIN",
                version: 1,
                created_at: now,
                updated_at: now,
                deleted_at: null,
                is_deleted: false
            };

            await this.horarioRepository.withTransaction(tx).create(newHorario, authenticatedGymId);

            // Record for sync
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "horario",
                operacion: "INSERT",
                entidadId: newHorario.horario_id,
                gymId: authenticatedGymId,
                deviceId: "WEB_ADMIN",
                payload: newHorario as any
            }, tx);

            return newHorario;
        });
    }
}

