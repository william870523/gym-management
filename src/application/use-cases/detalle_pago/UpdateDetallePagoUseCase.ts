import type { UpdateDetallePagoDTO } from "../../dtos/DetallePagoDTO";
import type { DetallePago } from "../../../domain/entities/DetallePago";
import type { DetallePagoRepository } from "../../../domain/repositories/DetallePagoRepository";

export class UpdateDetallePagoUseCase {
    constructor(private readonly detallePagoRepository: DetallePagoRepository) { }

    async execute(id: string, dto: UpdateDetallePagoDTO): Promise<void> {
        const existing = await this.detallePagoRepository.findById(id);
        if (!existing) {
            throw new Error("DetallePago not found");
        }

        const updateData: Partial<DetallePago> = {
            ...dto,
            updated_at: new Date()
        };

        await this.detallePagoRepository.update(id, updateData);
    }
}
