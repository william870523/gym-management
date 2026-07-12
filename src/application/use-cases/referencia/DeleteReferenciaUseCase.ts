import { randomUUID } from "crypto";
import type { ReferenciaRepository } from "../../../domain/repositories/ReferenciaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeleteReferenciaUseCase {
    constructor(
        private readonly referenciaRepository: ReferenciaRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string): Promise<void> {
        const existing = await this.referenciaRepository.findById(id);
        if (!existing) {
            throw new Error("Referencia not found");
        }

        await this.referenciaRepository.softDelete(id);

        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "referencia",
            operacion: "DELETE",
            entidadId: id,
            gymId: null,
            deviceId: "WEB_ADMIN",
            payload: { referencia_id: id }
        });
    }
}

