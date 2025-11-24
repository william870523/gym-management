import type { Referencia } from "../../../domain/entities/Referencia";
import type { ReferenciaRepository } from "../../../domain/repositories/ReferenciaRepository";

export class ListReferenciasUseCase {
    constructor(private readonly referenciaRepository: ReferenciaRepository) { }

    async execute(): Promise<Referencia[]> {
        return this.referenciaRepository.findAll();
    }
}
