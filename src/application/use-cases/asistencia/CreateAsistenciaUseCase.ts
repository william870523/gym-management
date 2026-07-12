import { randomUUID } from "crypto";
import type { CreateAsistenciaDTO } from "../../dtos/AsistenciaDTO";
import type { Asistencia } from "../../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class CreateAsistenciaUseCase {
    constructor(private readonly asistenciaRepository: AsistenciaRepository) { }

    async execute(dto: CreateAsistenciaDTO): Promise<Asistencia> {
        const occurredAt = trustedClock.nowUtc();
        const newAsistencia: Asistencia = {
            asistencia_id: dto.asistencia_id ?? randomUUID(),
            ci: dto.ci,
            fecha_salida: dto.fecha_salida ?? null,
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: occurredAt,
            updated_at: occurredAt,
            deleted_at: null,
            is_deleted: false
        };

        await this.asistenciaRepository.create(newAsistencia);
        return newAsistencia;
    }
}
