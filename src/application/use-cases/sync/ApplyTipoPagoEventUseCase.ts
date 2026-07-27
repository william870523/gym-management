import type { SyncTransactionContext } from "./sync-transaction";
import type { TipoPago } from "../../../domain/entities/TipoPago";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { TipoPagoRepository } from "../../../domain/repositories/TipoPagoRepository";

export interface ApplyTipoPagoEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyTipoPagoEventUseCase {
    constructor(
        private readonly tipoPagoRepository: TipoPagoRepository
    ) { }

    async execute(input: ApplyTipoPagoEventInput): Promise<void> {
        const repo = input.tx
            ? this.tipoPagoRepository.withTransaction(input.tx)
            : this.tipoPagoRepository;
        const { operacion } = input;

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId);
            return;
        }

        const tipoPago = this.mapPayloadToTipoPago(input);
        await repo.upsertTipoPago(tipoPago);
    }

    private mapPayloadToTipoPago(input: ApplyTipoPagoEventInput): TipoPago {
        const payload = input.payload as Record<string, unknown>;

        return {
            tipo_pago_id: input.entidadId,
            nombre_tipo_pago: String(payload.nombre_tipo_pago),
            codigo: payload.codigo ? String(payload.codigo) : null,
            activo: payload.activo !== undefined ? Boolean(payload.activo) : true,
            version: (payload.version as number) ?? 1,
            created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            updated_at: new Date(),
            is_deleted: false,
            deleted_at: null
        };

    }
}
