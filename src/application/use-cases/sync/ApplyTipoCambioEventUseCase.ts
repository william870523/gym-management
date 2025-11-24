import type { TipoCambio } from "../../../domain/entities/TipoCambio";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { TipoCambioRepository } from "../../../domain/repositories/TipoCambioRepository";

export interface ApplyTipoCambioEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
}

export class ApplyTipoCambioEventUseCase {
    constructor(
        private readonly tipoCambioRepository: TipoCambioRepository
    ) { }

    async execute(input: ApplyTipoCambioEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            return;
        }

        const tipoCambio = this.mapPayloadToTipoCambio(input);
        await this.tipoCambioRepository.upsertTipoCambio(tipoCambio);
    }

    private mapPayloadToTipoCambio(input: ApplyTipoCambioEventInput): TipoCambio {
        const payload = input.payload as Record<string, unknown>;

        return {
            tipo_cambio_id: input.entidadId,
            moneda_id_base: String(payload.moneda_id_base),
            moneda_id_target: String(payload.moneda_id_target),
            exchange_rate: Number(payload.exchange_rate),
            fecha_inicio: new Date(String(payload.fecha_inicio)),
            fecha_expiracion: payload.fecha_expiracion ? new Date(String(payload.fecha_expiracion)) : null,
            activo: Boolean(payload.activo),
            version: (payload.version as number) ?? 1,
            created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            updated_at: new Date(),
            is_deleted: false,
            deleted_at: null
        };
    }
}
