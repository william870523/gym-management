import type { TipoPago } from "../../../domain/entities/TipoPago";
import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";

export class GetTipoPagoUseCase {
    constructor(private readonly tipoPagoRepository: TipoPagoRepository) { }

    async execute(id: string): Promise<TipoPago | null> {
        return this.tipoPagoRepository.findById(id);
    }
}
