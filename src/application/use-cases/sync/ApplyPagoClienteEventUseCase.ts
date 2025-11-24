import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";

export interface ApplyPagoClienteEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
}

export class ApplyPagoClienteEventUseCase {
    constructor(
        private readonly pagoClienteRepository: PagoClienteRepository
    ) { }

    async execute(input: ApplyPagoClienteEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            // TODO: Implementar softDelete si es necesario
            return;
        }

        const pagoCliente = this.mapPayloadToPagoCliente(input);
        await this.pagoClienteRepository.upsertPagoCliente(pagoCliente);
    }

    private mapPayloadToPagoCliente(input: ApplyPagoClienteEventInput): PagoCliente {
        const payload = input.payload as Record<string, unknown>;

        return {
            pago_cliente_id: input.entidadId,
            ci: String(payload.ci),
            fecha: new Date(String(payload.fecha)),
            monto_total: Number(payload.monto_total),
            id_entrenador: (payload.id_entrenador as string | null) ?? null,
            id_planes_pago: String(payload.id_planes_pago),
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
