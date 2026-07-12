import { randomUUID } from "crypto";
import type { TipoCambioRepository } from "../../../domain/repositories/TipoCambioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeleteTipoCambioUseCase {
    constructor(
        private readonly tipoCambioRepository: TipoCambioRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string): Promise<void> {
        const existing = await this.tipoCambioRepository.findById(id);
        if (!existing) {
            throw new Error("TipoCambio not found");
        }

        await this.tipoCambioRepository.softDelete(id);

        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "tipo_cambio",
            operacion: "DELETE",
            entidadId: id,
            gymId: null,
            deviceId: "WEB_ADMIN",
            payload: { tipo_cambio_id: id }
        });
    }
}

