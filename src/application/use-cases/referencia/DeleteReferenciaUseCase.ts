import type { ReferenciaRepository } from "../../../domain/repositories/ReferenciaRepository";

export class DeleteReferenciaUseCase {
    constructor(private readonly referenciaRepository: ReferenciaRepository) { }

    async execute(id: string): Promise<void> {
        const existing = await this.referenciaRepository.findById(id);
        if (!existing) {
            throw new Error("Referencia not found");
        }

        await this.referenciaRepository.softDelete(id);
    }
}
