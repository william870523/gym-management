import { randomUUID } from "crypto";
import type { CreateHorarioDTO } from "../../dtos/HorarioDTO";
import type { Horario } from "../../../domain/entities/Horario";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class CreateHorarioUseCase {
    constructor(
        private readonly horarioRepository: HorarioRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: CreateHorarioDTO): Promise<Horario> {
        const newHorario: Horario = {
            horario_id: randomUUID(),
            nombre_horario: dto.nombre_horario,
            hora_inicio: dto.hora_inicio,
            hora_fin: dto.hora_fin,
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.horarioRepository.create(newHorario);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "horario",
            operacion: "INSERT",
            entidadId: newHorario.horario_id,
            gymId: newHorario.gym_id,
            deviceId: "WEB_ADMIN",
            payload: newHorario as any
        });

        return newHorario;
    }
}

