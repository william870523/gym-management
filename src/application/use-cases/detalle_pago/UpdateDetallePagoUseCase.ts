import type { UpdateDetallePagoDTO } from "../../dtos/DetallePagoDTO";
import type { DetallePago } from "../../../domain/entities/DetallePago";
import type { DetallePagoRepository } from "../../../domain/repositories/DetallePagoRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class UpdateDetallePagoUseCase {
    constructor(private readonly detallePagoRepository: DetallePagoRepository) { }

    async execute(id: string, dto: UpdateDetallePagoDTO, gymId: string): Promise<void> {
        const existing = await this.detallePagoRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("DetallePago not found");
        }

        const updateData: Partial<DetallePago> = {
            ...dto,
            updated_at: trustedClock.nowUtc()
        };

        await this.detallePagoRepository.update(id, gymId, updateData);
    }
}
