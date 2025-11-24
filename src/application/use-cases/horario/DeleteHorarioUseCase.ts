import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";

export class DeleteHorarioUseCase {
    constructor(private readonly horarioRepository: HorarioRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.horarioRepository.findById(id);
        if (!existing) {
            throw new Error("Horario not found");
        }

        await this.horarioRepository.softDelete(id);
    }
}
