import type { Entrenador } from "../../../domain/entities/Entrenador";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";

export class GetEntrenadorUseCase {
    constructor(private readonly entrenadorRepository: EntrenadorRepository) { }

    async execute(id: string, gymId: string): Promise<Entrenador | null> {
        return this.entrenadorRepository.findById(id, gymId);
    }
}
