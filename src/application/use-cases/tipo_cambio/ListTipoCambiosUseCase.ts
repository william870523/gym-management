import type { TipoCambio } from "../../../domain/entities/TipoCambio";
import type { TipoCambioRepository } from "../../../domain/repositories/TipoCambioRepository";

export class ListTipoCambiosUseCase {
    constructor(private readonly tipoCambioRepository: TipoCambioRepository) { }

    async execute(): Promise<TipoCambio[]> {
        return this.tipoCambioRepository.findAll();
    }
}
