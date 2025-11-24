import type { DetallePago } from "../../../domain/entities/DetallePago";
import type { DetallePagoRepository } from "../../../domain/repositories/DetallePagoRepository";

export class ListDetallePagosUseCase {
    constructor(private readonly detallePagoRepository: DetallePagoRepository) { }

    async execute(): Promise<DetallePago[]> {
        return this.detallePagoRepository.findAll();
    }
}
