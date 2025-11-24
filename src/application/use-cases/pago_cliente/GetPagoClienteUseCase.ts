import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";

export class GetPagoClienteUseCase {
    constructor(private readonly pagoClienteRepository: PagoClienteRepository) { }

    async execute(id: string): Promise<PagoCliente | null> {
        return this.pagoClienteRepository.findById(id);
    }
}
