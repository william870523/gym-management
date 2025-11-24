import type { DetallePago } from "../../../domain/entities/DetallePago";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { DetallePagoRepository } from "../../../domain/repositories/DetallePagoRepository";

export interface ApplyDetallePagoEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
}

export class ApplyDetallePagoEventUseCase {
    constructor(
        private readonly detallePagoRepository: DetallePagoRepository
    ) { }

    async execute(input: ApplyDetallePagoEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            // TODO: Implementar softDelete si es necesario
            return;
        }

        const detallePago = this.mapPayloadToDetallePago(input);
        await this.detallePagoRepository.upsertDetallePago(detallePago);
    }

    private mapPayloadToDetallePago(input: ApplyDetallePagoEventInput): DetallePago {
        const payload = input.payload as Record<string, unknown>;

        return {
            detalle_pago_id: input.entidadId,
            pago_cliente_id: String(payload.pago_cliente_id),
            tipo_pago_id: String(payload.tipo_pago_id),
            moneda_id: String(payload.moneda_id),
            cuenta_id: (payload.cuenta_id as string | null) ?? null,
            cantidad: Number(payload.cantidad),
            tipo_cambio_id: String(payload.tipo_cambio_id),
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
