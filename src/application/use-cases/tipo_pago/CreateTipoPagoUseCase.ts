import { randomUUID } from "crypto";
import type { CreateTipoPagoDTO } from "../../dtos/TipoPagoDTO";
import type { TipoPago } from "../../../domain/entities/TipoPago";
import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class CreateTipoPagoUseCase {
    constructor(
        private readonly tipoPagoRepository: TipoPagoRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: CreateTipoPagoDTO): Promise<TipoPago> {
        const newTipoPago: TipoPago = {
            tipo_pago_id: randomUUID(),
            nombre_tipo_pago: dto.nombre_tipo_pago,
            codigo: dto.codigo,
            activo: dto.activo ?? true,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.tipoPagoRepository.create(newTipoPago);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "tipo_pago",
            operacion: "INSERT",
            entidadId: newTipoPago.tipo_pago_id,
            gymId: null,
            deviceId: "WEB_ADMIN",
            payload: newTipoPago as any
        });

        return newTipoPago;
    }
}

