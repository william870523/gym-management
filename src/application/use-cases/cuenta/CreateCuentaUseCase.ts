import { randomUUID } from "crypto";
import type { CreateCuentaDTO } from "../../dtos/CuentaDTO";
import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class CreateCuentaUseCase {
    constructor(
        private readonly cuentaRepository: CuentaRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: CreateCuentaDTO, gymId: string): Promise<Cuenta> {
        const now = trustedClock.nowUtc();
        const newCuenta: Cuenta = {
            cuenta_id: randomUUID(),
            nombre_cuenta: dto.nombre_cuenta,
            moneda_id: dto.moneda_id,
            tipo_pago_id: dto.tipo_pago_id || null,
            gym_id: gymId,
            source_device: "WEB_ADMIN",
            version: 1,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            is_deleted: false
        };

        await this.cuentaRepository.create(newCuenta, gymId);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: randomUUID(),
            entidad: "cuenta",
            operacion: "INSERT",
            entidadId: newCuenta.cuenta_id,
            gymId,
            deviceId: "WEB_ADMIN",
            payload: newCuenta as any
        });

        return newCuenta;
    }
}

