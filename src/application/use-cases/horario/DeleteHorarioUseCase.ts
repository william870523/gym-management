import { randomUUID } from "crypto";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeleteHorarioUseCase {
    constructor(
        private readonly horarioRepository: HorarioRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string): Promise<void> {
        const existing = await this.horarioRepository.findById(id);
        if (!existing) {
            throw new Error("Horario not found");
        }

        await this.horarioRepository.softDelete(id);

        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "horario",
            operacion: "DELETE",
            entidadId: id,
            gymId: existing.gym_id,
            deviceId: "WEB_ADMIN",
            payload: { horario_id: id }
        });
    }
}

