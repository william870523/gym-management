import { randomUUID } from "crypto";
import type { CreateHorarioDTO } from "../../dtos/HorarioDTO";
import type { Horario } from "../../../domain/entities/Horario";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class CreateHorarioUseCase {
    constructor(
        private readonly horarioRepository: HorarioRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: CreateHorarioDTO, gymId: string): Promise<Horario> {
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

        await this.horarioRepository.create(newHorario, authenticatedGymId);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "horario",
            operacion: "INSERT",
            entidadId: newHorario.horario_id,
            gymId: authenticatedGymId,
            deviceId: "WEB_ADMIN",
            payload: newHorario as any
        });

        return newHorario;
    }
}

