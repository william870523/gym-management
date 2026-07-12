import { randomUUID } from "crypto";
import type { UpdateTipoCambioDTO } from "../../dtos/TipoCambioDTO";
import type { TipoCambio } from "../../../domain/entities/TipoCambio";
import type { TipoCambioRepository } from "../../../domain/repositories/TipoCambioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class UpdateTipoCambioUseCase {
    constructor(
        private readonly tipoCambioRepository: TipoCambioRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, dto: UpdateTipoCambioDTO): Promise<void> {
        const existing = await this.tipoCambioRepository.findById(id);
        if (!existing) {
            throw new Error("TipoCambio not found");
        }
        const nextBase = dto.moneda_id_base ?? existing.moneda_id_base;
        const nextTarget = dto.moneda_id_target ?? existing.moneda_id_target;
        if (nextBase === nextTarget) {
            throw new Error("Same-currency exchange rates are implicit 1:1 and must not be created");
        }

        const updateData: Partial<TipoCambio> = {
            ...dto,
            fecha_inicio: dto.fecha_inicio ? new Date(dto.fecha_inicio) : undefined,
            fecha_expiracion: dto.fecha_expiracion ? new Date(dto.fecha_expiracion) : undefined,
            updated_at: new Date(),
            version: (existing.version ?? 0) + 1
        };

        await this.tipoCambioRepository.update(id, updateData);

        const updated = await this.tipoCambioRepository.findById(id);

        if (updated) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "tipo_cambio",
                operacion: "UPDATE",
                entidadId: id,
                gymId: null,
                deviceId: "WEB_ADMIN",
                payload: updated as any
            });
        }
    }
}

