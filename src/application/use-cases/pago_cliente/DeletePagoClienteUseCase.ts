import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";

export class DeletePagoClienteUseCase {
    constructor(private readonly pagoClienteRepository: PagoClienteRepository) { }

    async execute(id: string, gymId: string): Promise<void> {
        const existing = await this.pagoClienteRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("PagoCliente not found");
        }

        await this.pagoClienteRepository.softDelete(id, gymId);
    }
}
