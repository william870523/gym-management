import type { UpdateReferenciaDTO } from "../../dtos/ReferenciaDTO";
import type { Referencia } from "../../../domain/entities/Referencia";
import type { ReferenciaRepository } from "../../../domain/repositories/ReferenciaRepository";

export class UpdateReferenciaUseCase {
    constructor(private readonly referenciaRepository: ReferenciaRepository) { }

    async execute(id: string, dto: UpdateReferenciaDTO): Promise<void> {
        const existing = await this.referenciaRepository.findById(id);
        if (!existing) {
            throw new Error("Referencia not found");
        }

        const updateData: Partial<Referencia> = {
            ...dto,
            updated_at: new Date()
        };

        await this.referenciaRepository.update(id, updateData);
    }
}
