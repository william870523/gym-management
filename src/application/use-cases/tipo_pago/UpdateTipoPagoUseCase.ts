import type { UpdateTipoPagoDTO } from "../../dtos/TipoPagoDTO";
import type { TipoPago } from "../../../domain/entities/TipoPago";
import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";

export class UpdateTipoPagoUseCase {
    constructor(private readonly tipoPagoRepository: TipoPagoRepository) { }

    async execute(id: string, dto: UpdateTipoPagoDTO): Promise<void> {
        const existing = await this.tipoPagoRepository.findById(id);
        if (!existing) {
            throw new Error("TipoPago not found");
        }

        const updateData: Partial<TipoPago> = {
            ...dto,
            updated_at: new Date()
        };

        await this.tipoPagoRepository.update(id, updateData);
    }
}
