import { randomUUID } from "crypto";
import type { CreateDetallePagoDTO } from "../../dtos/DetallePagoDTO";
import type { DetallePago } from "../../../domain/entities/DetallePago";
import type { DetallePagoRepository } from "../../../domain/repositories/DetallePagoRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class CreateDetallePagoUseCase {
    constructor(private readonly detallePagoRepository: DetallePagoRepository) { }

    async execute(dto: CreateDetallePagoDTO, gymId: string): Promise<DetallePago> {
        const now = trustedClock.nowUtc();
        const newDetallePago: DetallePago = {
            detalle_pago_id: randomUUID(),
            pago_cliente_id: dto.pago_cliente_id,
            tipo_pago_id: dto.tipo_pago_id,
            moneda_id: dto.moneda_id,
            cuenta_id: dto.cuenta_id ?? null,
            cantidad: dto.cantidad,
            tipo_cambio_id: dto.tipo_cambio_id,
            gym_id: gymId,
            source_device: null,
            version: 1,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            is_deleted: false
        };

        await this.detallePagoRepository.create(newDetallePago);
        return newDetallePago;
    }
}
