import { randomUUID } from "crypto";
import type { CreateEntrenadorDTO } from "../../dtos/EntrenadorDTO";
import type { Entrenador } from "../../../domain/entities/Entrenador";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class CreateEntrenadorUseCase {
    constructor(
        private readonly entrenadorRepository: EntrenadorRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: CreateEntrenadorDTO, gymId: string): Promise<Entrenador> {
        const now = trustedClock.nowUtc();
        const newEntrenador: Entrenador = {
            id_entrenador: randomUUID(),
            ci_entrenador: dto.ci_entrenador,
            tipo_documento: dto.tipo_documento,
            nombres_entrenador: dto.nombres_entrenador,
            apellidos_entrenador: dto.apellidos_entrenador,
            sexo_entrenador: dto.sexo_entrenador,
            foto_entrenador: dto.foto_entrenador ? Buffer.from(dto.foto_entrenador, 'base64') : null,
            direccion_entrenador: dto.direccion_entrenador ?? null,
            telefono_entrenador: dto.telefono_entrenador ?? null,
            correo_entrenador: dto.correo_entrenador ?? null,
            activo_entrenador: dto.activo_entrenador,
            fecha_incio_entrenador: new Date(dto.fecha_incio_entrenador),
            gym_id: gymId,
            source_device: null,
            version: 1,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            is_deleted: false
        };

        await this.entrenadorRepository.create(newEntrenador);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "entrenador",
            operacion: "INSERT",
            entidadId: newEntrenador.id_entrenador,
            gymId: newEntrenador.gym_id ?? null,
            deviceId: "WEB_ADMIN",
            payload: {
                ...newEntrenador,
                foto_entrenador: newEntrenador.foto_entrenador ? Buffer.from(newEntrenador.foto_entrenador).toString('base64') : null
            } as any
        });

        return newEntrenador;
    }
}

