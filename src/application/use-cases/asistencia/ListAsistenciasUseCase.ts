import type { Asistencia } from "../../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";

export class ListAsistenciasUseCase {
    constructor(private readonly asistenciaRepository: AsistenciaRepository) { }

    async execute(): Promise<Asistencia[]> {
        return this.asistenciaRepository.findAll();
    }
}
