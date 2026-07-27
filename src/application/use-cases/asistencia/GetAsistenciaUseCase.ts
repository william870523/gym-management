import type { Asistencia } from "../../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";

export class GetAsistenciaUseCase {
    constructor(private readonly asistenciaRepository: AsistenciaRepository) { }

    async execute(id: string, gymId: string): Promise<Asistencia | null> {
        return this.asistenciaRepository.findById(id, gymId);
    }
}
