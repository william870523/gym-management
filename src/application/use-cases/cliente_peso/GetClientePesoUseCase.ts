import type { ClientePeso } from "../../../domain/entities/ClientePeso";
import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";

export class GetClientePesoUseCase {
    constructor(private readonly clientePesoRepository: ClientePesoRepository) { }

    async execute(id: string): Promise<ClientePeso | null> {
        return this.clientePesoRepository.findById(id);
    }
}
