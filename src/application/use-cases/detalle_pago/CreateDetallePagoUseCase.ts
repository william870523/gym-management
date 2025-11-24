import { randomUUID } from "crypto";
import type { CreateDetallePagoDTO } from "../../dtos/DetallePagoDTO";
import type { DetallePago } from "../../../domain/entities/DetallePago";
import type { DetallePagoRepository } from "../../../domain/repositories/DetallePagoRepository";

export class CreateDetallePagoUseCase {
    constructor(private readonly detallePagoRepository: DetallePagoRepository) { }

    async execute(dto: CreateDetallePagoDTO): Promise<DetallePago> {
        const newDetallePago: DetallePago = {
            detalle_pago_id: randomUUID(),
            pago_cliente_id: dto.pago_cliente_id,
            tipo_pago_id: dto.tipo_pago_id,
            moneda_id: dto.moneda_id,
            cuenta_id: dto.cuenta_id ?? null,
            cantidad: dto.cantidad,
            tipo_cambio_id: dto.tipo_cambio_id,
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.detallePagoRepository.create(newDetallePago);
        return newDetallePago;
    }
}
