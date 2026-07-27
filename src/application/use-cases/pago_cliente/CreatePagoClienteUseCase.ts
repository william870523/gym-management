import { randomUUID } from "crypto";
import type { CreatePagoClienteDTO } from "../../dtos/PagoClienteDTO";
import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class CreatePagoClienteUseCase {
    constructor(private readonly pagoClienteRepository: PagoClienteRepository) { }

    async execute(dto: CreatePagoClienteDTO, gymId: string): Promise<PagoCliente> {
        const occurredAt = trustedClock.nowUtc();
        const newPagoCliente: PagoCliente = {
            pago_cliente_id: dto.pago_cliente_id ?? randomUUID(),
            ci: dto.ci,
            fecha: occurredAt,
            monto_total: dto.monto_total,
            id_entrenador: dto.id_entrenador ?? null,
            id_planes_pago: dto.id_planes_pago,
            moneda_id: dto.moneda_id,
            gym_id: gymId,
            source_device: null,
            version: 1,
            created_at: occurredAt,
            updated_at: occurredAt,
            deleted_at: null,
            is_deleted: false
        };

        await this.pagoClienteRepository.create(newPagoCliente);
        return newPagoCliente;
    }
}
