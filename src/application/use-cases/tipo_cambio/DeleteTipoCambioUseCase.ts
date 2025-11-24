import type { TipoCambioRepository } from "../../../domain/repositories/TipoCambioRepository";

export class DeleteTipoCambioUseCase {
    constructor(private readonly tipoCambioRepository: TipoCambioRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.tipoCambioRepository.findById(id);
        if (!existing) {
            throw new Error("TipoCambio not found");
        }

        await this.tipoCambioRepository.softDelete(id);
    }
}
