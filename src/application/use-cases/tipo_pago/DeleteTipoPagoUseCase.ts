import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";

export class DeleteTipoPagoUseCase {
    constructor(private readonly tipoPagoRepository: TipoPagoRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.tipoPagoRepository.findById(id);
        if (!existing) {
            throw new Error("TipoPago not found");
        }

        await this.tipoPagoRepository.softDelete(id);
    }
}
