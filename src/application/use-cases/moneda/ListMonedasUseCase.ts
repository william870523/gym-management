import type { Moneda } from "../../../domain/entities/Moneda";
import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";

export class ListMonedasUseCase {
    constructor(private readonly monedaRepository: MonedaRepository) { }

    async execute(): Promise<Moneda[]> {
        return this.monedaRepository.findAll();
    }
}
