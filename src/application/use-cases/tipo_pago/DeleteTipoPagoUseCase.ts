import { randomUUID } from "crypto";
import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeleteTipoPagoUseCase {
    constructor(
        private readonly tipoPagoRepository: TipoPagoRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string): Promise<void> {
        const existing = await this.tipoPagoRepository.findById(id);
        if (!existing) {
            throw new Error("TipoPago not found");
        }

        await this.tipoPagoRepository.softDelete(id);

        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "tipo_pago",
            operacion: "DELETE",
            entidadId: id,
            gymId: null,
            deviceId: "WEB_ADMIN",
            payload: { tipo_pago_id: id }
        });
    }
}

