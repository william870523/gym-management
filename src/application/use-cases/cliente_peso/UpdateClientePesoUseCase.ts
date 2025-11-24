import type { UpdateClientePesoDTO } from "../../dtos/ClientePesoDTO";
import type { ClientePeso } from "../../../domain/entities/ClientePeso";
import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";

export class UpdateClientePesoUseCase {
    constructor(private readonly clientePesoRepository: ClientePesoRepository) { }

    async execute(id: string, dto: UpdateClientePesoDTO): Promise<void> {
        const existing = await this.clientePesoRepository.findById(id);
        if (!existing) {
            throw new Error("ClientePeso not found");
        }

        const updateData: Partial<ClientePeso> = {
            ...dto,
            fecha: dto.fecha ? new Date(dto.fecha) : undefined,
            updated_at: new Date()
        };

        await this.clientePesoRepository.update(id, updateData);
    }
}
