import type { UpdateEntrenadorDTO } from "../../dtos/EntrenadorDTO";
import type { Entrenador } from "../../../domain/entities/Entrenador";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";

export class UpdateEntrenadorUseCase {
    constructor(private readonly entrenadorRepository: EntrenadorRepository) { }

    async execute(id: string, dto: UpdateEntrenadorDTO): Promise<void> {
        const existing = await this.entrenadorRepository.findById(id);
        if (!existing) {
            throw new Error("Entrenador not found");
        }

        const updateData: Partial<Entrenador> = {
            ...dto,
            foto_entrenador: dto.foto_entrenador ? Buffer.from(dto.foto_entrenador, 'base64') : undefined,
            fecha_incio_entrenador: dto.fecha_incio_entrenador ? new Date(dto.fecha_incio_entrenador) : undefined,
            updated_at: new Date()
        };

        await this.entrenadorRepository.update(id, updateData);
    }
}
