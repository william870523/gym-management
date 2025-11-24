import { randomUUID } from "crypto";
import type { CreateMonedaDTO } from "../../dtos/MonedaDTO";
import type { Moneda } from "../../../domain/entities/Moneda";
import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";

export class CreateMonedaUseCase {
    constructor(private readonly monedaRepository: MonedaRepository) { }

    async execute(dto: CreateMonedaDTO): Promise<Moneda> {
        const newMoneda: Moneda = {
            moneda_id: randomUUID(),
            moneda_nombre: dto.moneda_nombre,
            codigo: dto.codigo,
            simbolo: dto.simbolo ?? null,
            imagen: dto.imagen ? Buffer.from(dto.imagen, 'base64') : null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.monedaRepository.create(newMoneda);
        return newMoneda;
    }
}
