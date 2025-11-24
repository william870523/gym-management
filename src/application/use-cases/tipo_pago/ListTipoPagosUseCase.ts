import type { TipoPago } from "../../../domain/entities/TipoPago";
import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";

export class ListTipoPagosUseCase {
    constructor(private readonly tipoPagoRepository: TipoPagoRepository) { }

    async execute(): Promise<TipoPago[]> {
        return this.tipoPagoRepository.findAll();
    }
}
