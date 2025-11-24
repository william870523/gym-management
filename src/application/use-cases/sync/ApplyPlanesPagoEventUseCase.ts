import type { PlanesPago } from "../../../domain/entities/PlanesPago";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { PlanesPagoRepository } from "../../../domain/repositories/PlanesPagoRepository";

export interface ApplyPlanesPagoEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
}

export class ApplyPlanesPagoEventUseCase {
    constructor(
        private readonly planesPagoRepository: PlanesPagoRepository
    ) { }

    async execute(input: ApplyPlanesPagoEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            return;
        }

        const planesPago = this.mapPayloadToPlanesPago(input);
        await this.planesPagoRepository.upsertPlanesPago(planesPago);
    }

    private mapPayloadToPlanesPago(input: ApplyPlanesPagoEventInput): PlanesPago {
        const payload = input.payload as Record<string, unknown>;

        return {
            id_planes_pago: input.entidadId,
            nombre_plan_pago: (payload.nombre_plan_pago as string | null) ?? null,
            importe_plan_pago: Number(payload.importe_plan_pago),
            duracion_plan_pago: Number(payload.duracion_plan_pago),
            activo: Boolean(payload.activo),
            moneda_id: String(payload.moneda_id),
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
