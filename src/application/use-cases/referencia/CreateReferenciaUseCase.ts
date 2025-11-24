import { randomUUID } from "crypto";
import type { CreateReferenciaDTO } from "../../dtos/ReferenciaDTO";
import type { Referencia } from "../../../domain/entities/Referencia";
import type { ReferenciaRepository } from "../../../domain/repositories/ReferenciaRepository";

export class CreateReferenciaUseCase {
    constructor(private readonly referenciaRepository: ReferenciaRepository) { }

    async execute(dto: CreateReferenciaDTO): Promise<Referencia> {
        const newReferencia: Referencia = {
            referencia_id: randomUUID(),
            nombre_referencia: dto.nombre_referencia,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.referenciaRepository.create(newReferencia);
        return newReferencia;
    }
}
