import type { Entrenador } from "../../../domain/entities/Entrenador";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";

export class ListEntrenadoresUseCase {
    constructor(private readonly entrenadorRepository: EntrenadorRepository) { }

    async execute(gymId: string): Promise<Entrenador[]> {
        return this.entrenadorRepository.findAll(gymId);
    }
}
