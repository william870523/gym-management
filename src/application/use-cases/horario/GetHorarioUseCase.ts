import type { Horario } from "../../../domain/entities/Horario";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";

export class GetHorarioUseCase {
    constructor(private readonly horarioRepository: HorarioRepository) { }

    async execute(id: string, gymId: string): Promise<Horario | null> {
        return this.horarioRepository.findById(id, gymId);
    }
}
