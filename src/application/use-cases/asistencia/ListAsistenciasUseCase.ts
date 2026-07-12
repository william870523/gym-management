import type { Asistencia } from "../../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";

export class ListAsistenciasUseCase {
    constructor(private readonly asistenciaRepository: AsistenciaRepository) { }

    async execute(page: number = 1, limit: number = 10): Promise<Asistencia[]> {
        const skip = (page - 1) * limit;
        return this.asistenciaRepository.findAll(skip, limit);
    }
}
