import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";

export class DeleteClientePesoUseCase {
    constructor(private readonly clientePesoRepository: ClientePesoRepository) { }

    async execute(id: string, gymId: string): Promise<void> {
        const existing = await this.clientePesoRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("ClientePeso not found");
        }

        await this.clientePesoRepository.softDelete(id, gymId);
    }
}
