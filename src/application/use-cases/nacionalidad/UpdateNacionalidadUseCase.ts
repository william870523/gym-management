import type { UpdateNacionalidadDTO } from "../../dtos/NacionalidadDTO";
import type { Nacionalidad } from "../../../domain/entities/Nacionalidad";
import type { NacionalidadRepository } from "../../../domain/repositories/NacionalidadRepository";

export class UpdateNacionalidadUseCase {
    constructor(private readonly nacionalidadRepository: NacionalidadRepository) { }

    async execute(id: string, dto: UpdateNacionalidadDTO): Promise<void> {
        const existing = await this.nacionalidadRepository.findById(id);
        if (!existing) {
            throw new Error("Nacionalidad not found");
        }

        const updateData: Partial<Nacionalidad> = {
            ...dto,
            bandera: dto.bandera ? Buffer.from(dto.bandera, 'base64') : undefined,
            updated_at: new Date()
        };

        await this.nacionalidadRepository.update(id, updateData);
    }
}
