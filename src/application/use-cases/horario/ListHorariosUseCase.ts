import type { Horario } from "../../../domain/entities/Horario";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";

export class ListHorariosUseCase {
    constructor(private readonly horarioRepository: HorarioRepository) { }

    async execute(gymId: string): Promise<Horario[]> {
        return this.horarioRepository.findAll(gymId);
    }
}
