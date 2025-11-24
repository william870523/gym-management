import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";

export class DeleteEntrenadorUseCase {
    constructor(private readonly entrenadorRepository: EntrenadorRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.entrenadorRepository.findById(id);
        if (!existing) {
            throw new Error("Entrenador not found");
        }

        await this.entrenadorRepository.softDelete(id);
    }
}
