import type { UpdatePagoClienteDTO } from "../../dtos/PagoClienteDTO";
import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class UpdatePagoClienteUseCase {
    constructor(private readonly pagoClienteRepository: PagoClienteRepository) { }

    async execute(id: string, dto: UpdatePagoClienteDTO, gymId: string): Promise<void> {
        const existing = await this.pagoClienteRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("PagoCliente not found");
        }

        const updateData: Partial<PagoCliente> = {
            ...dto,
            fecha: dto.fecha ? new Date(dto.fecha) : undefined,
            updated_at: trustedClock.nowUtc()
        };

        await this.pagoClienteRepository.update(id, gymId, updateData);
    }
}
