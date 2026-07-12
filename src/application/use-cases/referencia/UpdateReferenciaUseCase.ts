import { randomUUID } from "crypto";
import type { UpdateReferenciaDTO } from "../../dtos/ReferenciaDTO";
import type { Referencia } from "../../../domain/entities/Referencia";
import type { ReferenciaRepository } from "../../../domain/repositories/ReferenciaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class UpdateReferenciaUseCase {
    constructor(
        private readonly referenciaRepository: ReferenciaRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, dto: UpdateReferenciaDTO): Promise<void> {
        const existing = await this.referenciaRepository.findById(id);
        if (!existing) {
            throw new Error("Referencia not found");
        }

        const updateData: Partial<Referencia> = {
            ...dto,
            updated_at: new Date(),
            version: (existing.version ?? 0) + 1
        };

        await this.referenciaRepository.update(id, updateData);

        const updated = await this.referenciaRepository.findById(id);
        if (updated) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "referencia",
                operacion: "UPDATE",
                entidadId: id,
                gymId: null,
                deviceId: "WEB_ADMIN",
                payload: updated as any
            });
        }
    }
}

