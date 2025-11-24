import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";

export class DeleteAsistenciaUseCase {
    constructor(private readonly asistenciaRepository: AsistenciaRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.asistenciaRepository.findById(id);
        if (!existing) {
            throw new Error("Asistencia not found");
        }

        await this.asistenciaRepository.softDelete(id);
    }
}
