import { randomUUID } from "crypto";
import type { CreateCuentaDTO } from "../../dtos/CuentaDTO";
import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";

export class CreateCuentaUseCase {
    constructor(private readonly cuentaRepository: CuentaRepository) { }

    async execute(dto: CreateCuentaDTO): Promise<Cuenta> {
        const newCuenta: Cuenta = {
            cuenta_id: randomUUID(),
            nombre_cuenta: dto.nombre_cuenta,
            moneda_id: dto.moneda_id,
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.cuentaRepository.create(newCuenta);
        return newCuenta;
    }
}
