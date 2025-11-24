import type { UpdateMonedaDTO } from "../../dtos/MonedaDTO";
import type { Moneda } from "../../../domain/entities/Moneda";
import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";

export class UpdateMonedaUseCase {
    constructor(private readonly monedaRepository: MonedaRepository) { }

    async execute(id: string, dto: UpdateMonedaDTO): Promise<void> {
        const existing = await this.monedaRepository.findById(id);
        if (!existing) {
            throw new Error("Moneda not found");
        }

        const updateData: Partial<Moneda> = {
            ...dto,
            imagen: dto.imagen ? Buffer.from(dto.imagen, 'base64') : undefined,
            updated_at: new Date()
        };

        await this.monedaRepository.update(id, updateData);
    }
}
