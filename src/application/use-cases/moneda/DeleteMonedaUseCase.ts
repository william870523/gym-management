import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { randomUUID } from "crypto";

export class DeleteMonedaUseCase {
    constructor(
        private readonly monedaRepository: MonedaRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string): Promise<void> {
        const existing = await this.monedaRepository.findById(id);
        if (!existing) {
            throw new Error("Moneda not found");
        }

        await this.monedaRepository.softDelete(id);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "moneda",
            operacion: "DELETE",
            entidadId: id,
            gymId: null, // Global entity
            deviceId: "WEB_ADMIN",
            payload: { moneda_id: id, is_deleted: true }
        });
    }
}
