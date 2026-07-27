import { randomUUID } from "crypto";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeleteHorarioUseCase {
    constructor(
        private readonly horarioRepository: HorarioRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, gymId: string): Promise<void> {
        const existing = await this.horarioRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("Horario not found");
        }

        await this.horarioRepository.softDelete(id, gymId);

        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "horario",
            operacion: "DELETE",
            entidadId: id,
            gymId,
            deviceId: "WEB_ADMIN",
            payload: { horario_id: id }
        });
    }
}

