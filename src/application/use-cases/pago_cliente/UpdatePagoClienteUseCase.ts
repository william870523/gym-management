import type { UpdatePagoClienteDTO } from "../../dtos/PagoClienteDTO";
import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";

export class UpdatePagoClienteUseCase {
    constructor(private readonly pagoClienteRepository: PagoClienteRepository) { }

    async execute(id: string, dto: UpdatePagoClienteDTO): Promise<void> {
        const existing = await this.pagoClienteRepository.findById(id);
        if (!existing) {
            throw new Error("PagoCliente not found");
        }

        const updateData: Partial<PagoCliente> = {
            ...dto,
            fecha: dto.fecha ? new Date(dto.fecha) : undefined,
            updated_at: new Date()
        };

        await this.pagoClienteRepository.update(id, updateData);
    }
}
