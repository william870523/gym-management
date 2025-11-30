import { randomUUID } from "crypto";
import type { CreateClientePesoDTO } from "../../dtos/ClientePesoDTO";
import type { ClientePeso } from "../../../domain/entities/ClientePeso";
import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";

export class CreateClientePesoUseCase {
    constructor(private readonly clientePesoRepository: ClientePesoRepository) { }

    async execute(dto: CreateClientePesoDTO): Promise<ClientePeso> {
        const newClientePeso: ClientePeso = {
            cliente_peso_id: dto.cliente_peso_id ?? randomUUID(),
            ci: dto.ci,
            fecha: new Date(dto.fecha),
            peso: dto.peso,
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.clientePesoRepository.create(newClientePeso);
        return newClientePeso;
    }
}
