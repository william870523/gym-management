import { randomUUID } from "crypto";
import type { CreatePagoClienteDTO } from "../../dtos/PagoClienteDTO";
import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";

export class CreatePagoClienteUseCase {
    constructor(private readonly pagoClienteRepository: PagoClienteRepository) { }

    async execute(dto: CreatePagoClienteDTO): Promise<PagoCliente> {
        const newPagoCliente: PagoCliente = {
            pago_cliente_id: randomUUID(),
            ci: dto.ci,
            fecha: new Date(dto.fecha),
            monto_total: dto.monto_total,
            id_entrenador: dto.id_entrenador ?? null,
            id_planes_pago: dto.id_planes_pago,
            moneda_id: dto.moneda_id,
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.pagoClienteRepository.create(newPagoCliente);
        return newPagoCliente;
    }
}
