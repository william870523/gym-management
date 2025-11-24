import type { Cliente } from "../../../domain/entities/Cliente";
import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";

export class GetClienteUseCase {
    constructor(private readonly clienteRepository: ClienteRepository) { }

    async execute(id: string): Promise<Cliente | null> {
        return this.clienteRepository.findById(id);
    }
}
