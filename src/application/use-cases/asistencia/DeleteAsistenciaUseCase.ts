import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";

export class DeleteAsistenciaUseCase {
    constructor(private readonly asistenciaRepository: AsistenciaRepository) { }

    async execute(id: string, gymId: string): Promise<void> {
        const existing = await this.asistenciaRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("Asistencia not found");
        }

        await this.asistenciaRepository.softDelete(id, gymId);
    }
}
