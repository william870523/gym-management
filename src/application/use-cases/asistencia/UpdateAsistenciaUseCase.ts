import type { UpdateAsistenciaDTO } from "../../dtos/AsistenciaDTO";
import type { Asistencia } from "../../../domain/entities/Asistencia";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class UpdateAsistenciaUseCase {
    constructor(private readonly asistenciaRepository: AsistenciaRepository) { }

    async execute(id: string, dto: UpdateAsistenciaDTO, gymId: string): Promise<void> {
        const existing = await this.asistenciaRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("Asistencia not found");
        }

        const updateData: Partial<Asistencia> = {
            ...dto,
            updated_at: trustedClock.nowUtc()
        };

        await this.asistenciaRepository.update(id, gymId, updateData);
    }
}
