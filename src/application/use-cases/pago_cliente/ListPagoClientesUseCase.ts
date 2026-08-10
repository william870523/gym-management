import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";

export class ListPagoClientesUseCase {
    constructor(private readonly pagoClienteRepository: PagoClienteRepository) { }

    async execute(gymId: string, skip = 0, take = 500): Promise<PagoCliente[]> {
        return this.pagoClienteRepository.findAll(gymId, skip, take);
    }
}
