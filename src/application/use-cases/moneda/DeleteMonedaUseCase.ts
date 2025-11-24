import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";

export class DeleteMonedaUseCase {
    constructor(private readonly monedaRepository: MonedaRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.monedaRepository.findById(id);
        if (!existing) {
            throw new Error("Moneda not found");
        }

        await this.monedaRepository.softDelete(id);
    }
}
