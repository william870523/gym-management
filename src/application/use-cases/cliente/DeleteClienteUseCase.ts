import type { ClienteRepository } from "../../../domain/repositories/ClienteRepository";

export class DeleteClienteUseCase {
    constructor(private readonly clienteRepository: ClienteRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.clienteRepository.findById(id);
        if (!existing) {
            throw new Error("Cliente not found");
        }

        await this.clienteRepository.softDelete(id);
    }
}
