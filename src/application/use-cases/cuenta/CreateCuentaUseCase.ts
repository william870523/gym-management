import { randomUUID } from "crypto";
import type { CreateCuentaDTO } from "../../dtos/CuentaDTO";
import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class CreateCuentaUseCase {
    constructor(
        private readonly cuentaRepository: CuentaRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: CreateCuentaDTO): Promise<Cuenta> {
        const newCuenta: Cuenta = {
            cuenta_id: randomUUID(),
            nombre_cuenta: dto.nombre_cuenta,
            moneda_id: dto.moneda_id,
            tipo_pago_id: dto.tipo_pago_id || null,
            gym_id: dto.gym_id ?? null,
            source_device: null,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
            deleted_at: null,
            is_deleted: false
        };

        await this.cuentaRepository.create(newCuenta);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "cuenta",
            operacion: "INSERT",
            entidadId: newCuenta.cuenta_id,
            gymId: newCuenta.gym_id,
            deviceId: "WEB_ADMIN",
            payload: newCuenta as any
        });

        return newCuenta;
    }
}

