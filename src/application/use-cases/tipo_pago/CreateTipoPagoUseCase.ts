import { randomUUID } from "crypto";
import type { CreateTipoPagoDTO } from "../../dtos/TipoPagoDTO";
import type { TipoPago } from "../../../domain/entities/TipoPago";
import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";

export class CreateTipoPagoUseCase {
    constructor(private readonly tipoPagoRepository: TipoPagoRepository) { }

    async execute(dto: CreateTipoPagoDTO): Promise<TipoPago> {
        const newTipoPago: TipoPago = {
            tipo_pago_id: randomUUID(),
            nombre_tipo_pago: dto.nombre_tipo_pago,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.tipoPagoRepository.create(newTipoPago);
        return newTipoPago;
    }
}
