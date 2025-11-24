import type { DetallePago } from "../../../domain/entities/DetallePago";
import type { DetallePagoRepository } from "../../../domain/repositories/DetallePagoRepository";

export class GetDetallePagoUseCase {
    constructor(private readonly detallePagoRepository: DetallePagoRepository) { }

    async execute(id: string): Promise<DetallePago | null> {
        return this.detallePagoRepository.findById(id);
    }
}
