import { randomUUID } from "crypto";
import type { CreateEntrenadorDTO } from "../../dtos/EntrenadorDTO";
import type { Entrenador } from "../../../domain/entities/Entrenador";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";

export class CreateEntrenadorUseCase {
    constructor(private readonly entrenadorRepository: EntrenadorRepository) { }

    async execute(dto: CreateEntrenadorDTO): Promise<Entrenador> {
        const newEntrenador: Entrenador = {
            id_entrenador: randomUUID(),
            ci_entrenador: dto.ci_entrenador,
            nombres_entrenador: dto.nombres_entrenador,
            apellidos_entrenador: dto.apellidos_entrenador,
            sexo_entrenador: dto.sexo_entrenador,
            foto_entrenador: dto.foto_entrenador ? Buffer.from(dto.foto_entrenador, 'base64') : null,
            direccion_entrenador: dto.direccion_entrenador ?? null,
            telefono_entrenador: dto.telefono_entrenador ?? null,
            correo_entrenador: dto.correo_entrenador ?? null,
            activo_entrenador: dto.activo_entrenador,
            fecha_incio_entrenador: new Date(dto.fecha_incio_entrenador),
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.entrenadorRepository.create(newEntrenador);
        return newEntrenador;
    }
}
