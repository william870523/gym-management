import type { Moneda } from "../../../domain/entities/Moneda";
import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";

export class GetMonedaUseCase {
    constructor(private readonly monedaRepository: MonedaRepository) { }

    async execute(id: string): Promise<Moneda | null> {
        return this.monedaRepository.findById(id);
    }
}
