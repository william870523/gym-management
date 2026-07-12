import { randomUUID } from "crypto";
import type { UpdateTipoPagoDTO } from "../../dtos/TipoPagoDTO";
import type { TipoPago } from "../../../domain/entities/TipoPago";
import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class UpdateTipoPagoUseCase {
    constructor(
        private readonly tipoPagoRepository: TipoPagoRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, dto: UpdateTipoPagoDTO): Promise<void> {
        const existing = await this.tipoPagoRepository.findById(id);
        if (!existing) {
            throw new Error("TipoPago not found");
        }

        const updateData: Partial<TipoPago> = {
            ...dto,
            updated_at: new Date(),
            version: (existing.version ?? 0) + 1
        };

        await this.tipoPagoRepository.update(id, updateData);

        const updated = await this.tipoPagoRepository.findById(id);
        if (updated) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "tipo_pago",
                operacion: "UPDATE",
                entidadId: id,
                gymId: null,
                deviceId: "WEB_ADMIN",
                payload: updated as any
            });
        }
    }
}

