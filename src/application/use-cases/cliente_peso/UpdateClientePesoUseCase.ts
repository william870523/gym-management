import type { UpdateClientePesoDTO } from "../../dtos/ClientePesoDTO";
import type { ClientePeso } from "../../../domain/entities/ClientePeso";
import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class UpdateClientePesoUseCase {
    constructor(private readonly clientePesoRepository: ClientePesoRepository) { }

    async execute(id: string, dto: UpdateClientePesoDTO, gymId: string): Promise<void> {
        const existing = await this.clientePesoRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("ClientePeso not found");
        }

        const updateData: Partial<ClientePeso> = {
            ...dto,
            fecha: dto.fecha ? new Date(dto.fecha) : undefined,
            updated_at: trustedClock.nowUtc()
        };

        await this.clientePesoRepository.update(id, gymId, updateData);
    }
}
