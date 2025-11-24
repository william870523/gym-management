import type { ClientePeso } from "../../../domain/entities/ClientePeso";
import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";

export class ListClientePesosUseCase {
    constructor(private readonly clientePesoRepository: ClientePesoRepository) { }

    async execute(): Promise<ClientePeso[]> {
        return this.clientePesoRepository.findAll();
    }
}
