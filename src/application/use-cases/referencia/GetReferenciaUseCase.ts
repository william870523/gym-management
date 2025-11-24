import type { Referencia } from "../../../domain/entities/Referencia";
import type { ReferenciaRepository } from "../../../domain/repositories/ReferenciaRepository";

export class GetReferenciaUseCase {
    constructor(private readonly referenciaRepository: ReferenciaRepository) { }

    async execute(id: string): Promise<Referencia | null> {
        return this.referenciaRepository.findById(id);
    }
}
