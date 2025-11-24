import type { UpdateTipoCambioDTO } from "../../dtos/TipoCambioDTO";
import type { TipoCambio } from "../../../domain/entities/TipoCambio";
import type { TipoCambioRepository } from "../../../domain/repositories/TipoCambioRepository";

export class UpdateTipoCambioUseCase {
    constructor(private readonly tipoCambioRepository: TipoCambioRepository) { }

    async execute(id: string, dto: UpdateTipoCambioDTO): Promise<void> {
        const existing = await this.tipoCambioRepository.findById(id);
        if (!existing) {
            throw new Error("TipoCambio not found");
        }

        const updateData: Partial<TipoCambio> = {
            ...dto,
            fecha_inicio: dto.fecha_inicio ? new Date(dto.fecha_inicio) : undefined,
            fecha_expiracion: dto.fecha_expiracion ? new Date(dto.fecha_expiracion) : undefined,
            updated_at: new Date()
        };

        await this.tipoCambioRepository.update(id, updateData);
    }
}
