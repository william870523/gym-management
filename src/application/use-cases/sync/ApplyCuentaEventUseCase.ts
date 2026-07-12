import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";

export interface ApplyCuentaEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
}

export class ApplyCuentaEventUseCase {
    constructor(
        private readonly cuentaRepository: CuentaRepository
    ) { }

    async execute(input: ApplyCuentaEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            await this.cuentaRepository.softDelete(input.entidadId);
            return;
        }

        const cuenta = this.mapPayloadToCuenta(input);
        await this.cuentaRepository.upsertCuenta(cuenta);
    }

    private mapPayloadToCuenta(input: ApplyCuentaEventInput): Cuenta {
        const payload = input.payload as Record<string, unknown>;

        return {
            cuenta_id: input.entidadId,
            nombre_cuenta: String(payload.nombre_cuenta),
            moneda_id: String(payload.moneda_id),
            tipo_pago_id: payload.tipo_pago_id ? String(payload.tipo_pago_id) : null,
            gym_id: input.gymId,
            source_device: (payload.source_device as string | null) ?? input.deviceId,
            version: (payload.version as number) ?? 1,
            created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            updated_at: new Date(),
            is_deleted: false,
            deleted_at: null
        };
    }
}
