import type { DetallePagoRepository } from "../../../domain/repositories/DetallePagoRepository";

export class DeleteDetallePagoUseCase {
    constructor(private readonly detallePagoRepository: DetallePagoRepository) { }

    async execute(id: string, gymId: string): Promise<void> {
        const existing = await this.detallePagoRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("DetallePago not found");
        }

        await this.detallePagoRepository.softDelete(id, gymId);
    }
}
