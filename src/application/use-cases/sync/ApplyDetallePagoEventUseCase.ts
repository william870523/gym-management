import type { SyncTransactionContext } from "./sync-transaction";
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
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyDetallePagoEventUseCase {
    constructor(
        private readonly detallePagoRepository: DetallePagoRepository
    ) { }

    async execute(input: ApplyDetallePagoEventInput): Promise<void> {
        const repo = input.tx
            ? this.detallePagoRepository.withTransaction(input.tx)
            : this.detallePagoRepository;
        const { operacion } = input;

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId, input.gymId);
            return;
        }

        const detallePago = this.mapPayloadToDetallePago(input);
        await repo.upsertDetallePago(detallePago);
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
            tipo_cambio_id: payload.tipo_cambio_id ? String(payload.tipo_cambio_id) : null,
            recargo_metodo_base: payload.recargo_metodo_base == null
                ? null : String(payload.recargo_metodo_base),
            recargo_metodo_pct: payload.recargo_metodo_pct == null
                ? null : String(payload.recargo_metodo_pct),
            recargo_metodo_importe: payload.recargo_metodo_importe == null
                ? null : String(payload.recargo_metodo_importe),
            recargo_metodo_total: payload.recargo_metodo_total == null
                ? null : String(payload.recargo_metodo_total),
            recargo_metodo_politica: payload.recargo_metodo_politica == null
                ? null : String(payload.recargo_metodo_politica),
            recargo_metodo_tasa_version: payload.recargo_metodo_tasa_version == null
                ? null : Number(payload.recargo_metodo_tasa_version),
            // Snapshot congelado del recargo por mora (docs/RECARGO_MORA.md).
            // Histórico anterior al recargo llega nulo y así se conserva.
            recargo_mora_modo_snapshot: payload.recargo_mora_modo_snapshot == null
                ? null
                : String(payload.recargo_mora_modo_snapshot),
            recargo_mora_dias_atraso: payload.recargo_mora_dias_atraso == null
                ? null
                : Number(payload.recargo_mora_dias_atraso),
            recargo_mora_base: payload.recargo_mora_base == null
                ? null
                : String(payload.recargo_mora_base),
            recargo_mora_importe: payload.recargo_mora_importe == null
                ? null
                : String(payload.recargo_mora_importe),
            recargo_mora_plan_valor: payload.recargo_mora_plan_valor == null
                ? null
                : String(payload.recargo_mora_plan_valor),
            recargo_mora_plan_tope: payload.recargo_mora_plan_tope == null
                ? null
                : String(payload.recargo_mora_plan_tope),
            gym_id: input.gymId,
            source_device: input.deviceId,
            version: (payload.version as number) ?? 1,
            created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            updated_at: new Date(),
            is_deleted: false,
            deleted_at: null
        };
    }
}
