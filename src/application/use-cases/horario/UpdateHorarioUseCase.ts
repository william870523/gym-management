import type { UpdateHorarioDTO } from "../../dtos/HorarioDTO";
import type { Horario } from "../../../domain/entities/Horario";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";

export class UpdateHorarioUseCase {
    constructor(private readonly horarioRepository: HorarioRepository) { }

    async execute(id: string, dto: UpdateHorarioDTO): Promise<void> {
        const existing = await this.horarioRepository.findById(id);
        if (!existing) {
            throw new Error("Horario not found");
        }

        const updateData: Partial<Horario> = {
            ...dto,
            updated_at: new Date()
        };

        await this.horarioRepository.update(id, updateData);
    }
}
