import type { UpdateAsistenciaDTO } from "../../dtos/AsistenciaDTO";
import type { Asistencia } from "../../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";

export class UpdateAsistenciaUseCase {
    constructor(private readonly asistenciaRepository: AsistenciaRepository) { }

    async execute(id: string, dto: UpdateAsistenciaDTO): Promise<void> {
        const existing = await this.asistenciaRepository.findById(id);
        if (!existing) {
            throw new Error("Asistencia not found");
        }

        const updateData: Partial<Asistencia> = {
            ...dto,
            updated_at: new Date()
        };

        await this.asistenciaRepository.update(id, updateData);
    }
}
