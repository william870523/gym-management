import { randomUUID } from "crypto";
import type { CreateTipoCambioDTO } from "../../dtos/TipoCambioDTO";
import type { TipoCambio } from "../../../domain/entities/TipoCambio";
import type { TipoCambioRepository } from "../../../domain/repositories/TipoCambioRepository";

export class CreateTipoCambioUseCase {
    constructor(private readonly tipoCambioRepository: TipoCambioRepository) { }

    async execute(dto: CreateTipoCambioDTO): Promise<TipoCambio> {
        const newTipoCambio: TipoCambio = {
            tipo_cambio_id: randomUUID(),
            moneda_id_base: dto.moneda_id_base,
            moneda_id_target: dto.moneda_id_target,
            exchange_rate: dto.exchange_rate,
            fecha_inicio: new Date(dto.fecha_inicio),
            fecha_expiracion: dto.fecha_expiracion ? new Date(dto.fecha_expiracion) : null,
            activo: dto.activo ?? true,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.tipoCambioRepository.create(newTipoCambio);
        return newTipoCambio;
    }
}
