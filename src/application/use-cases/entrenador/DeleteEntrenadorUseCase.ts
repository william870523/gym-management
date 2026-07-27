import { randomUUID } from "crypto";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeleteEntrenadorUseCase {
    constructor(
        private readonly entrenadorRepository: EntrenadorRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, gymId: string): Promise<void> {
        const existing = await this.entrenadorRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("Entrenador not found");
        }

        await this.entrenadorRepository.softDelete(id, gymId);

        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "entrenador",
            operacion: "DELETE",
            entidadId: id,
            gymId: existing.gym_id ?? null,
            deviceId: "WEB_ADMIN",
            payload: { id_entrenador: id }
        });
    }
}

