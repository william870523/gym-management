import type { TipoCambio } from "../../../domain/entities/TipoCambio";
import type { TipoCambioRepository } from "../../../domain/repositories/TipoCambioRepository";

export class GetTipoCambioUseCase {
    constructor(private readonly tipoCambioRepository: TipoCambioRepository) { }

    async execute(id: string): Promise<TipoCambio | null> {
        return this.tipoCambioRepository.findById(id);
    }
}
