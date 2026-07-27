import type { Cliente } from "../../../domain/entities/Cliente";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";

export class ListClientesUseCase {
    constructor(private readonly clienteRepository: ClienteRepository) { }

    async execute(gymId: string): Promise<Cliente[]> {
        return this.clienteRepository.findAll(gymId);
    }
}
