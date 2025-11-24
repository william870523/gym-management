import type { Horario } from "../../../domain/entities/Horario";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";

export class ListHorariosUseCase {
    constructor(private readonly horarioRepository: HorarioRepository) { }

    async execute(): Promise<Horario[]> {
        return this.horarioRepository.findAll();
    }
}
