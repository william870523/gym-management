import { randomUUID } from "crypto";
import type { CreateNacionalidadDTO } from "../../dtos/NacionalidadDTO";
import type { Nacionalidad } from "../../../domain/entities/Nacionalidad";
import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";

export class CreateNacionalidadUseCase {
    constructor(private readonly nacionalidadRepository: NacionalidadRepository) { }

    async execute(dto: CreateNacionalidadDTO): Promise<Nacionalidad> {
        const newNacionalidad: Nacionalidad = {
            nacionalidad_id: randomUUID(),
            nacionalidad_nombre: dto.nacionalidad_nombre,
            codigo_iso: dto.codigo_iso,
            bandera: dto.bandera ? Buffer.from(dto.bandera, 'base64') : null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.nacionalidadRepository.create(newNacionalidad);
        return newNacionalidad;
    }
}
