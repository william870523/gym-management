import type { SyncTransactionContext } from "./sync-transaction";
import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";
import { trustedClock } from "../../../config/trusted-clock";
import {
    collectorColumns,
    frozenActorFromSyncPayload,
} from "../../payment/payment-actor";

/** Actor congelado del payload, o los cuatro nulos si el cobro es histórico. */
function frozenCollectorColumns(payload: Record<string, unknown>) {
    return collectorColumns(frozenActorFromSyncPayload(payload));
}

export interface ApplyPagoClienteEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyPagoClienteEventUseCase {
    constructor(
        private readonly pagoClienteRepository: PagoClienteRepository
    ) { }

    async execute(input: ApplyPagoClienteEventInput): Promise<void> {
        const repo = input.tx
            ? this.pagoClienteRepository.withTransaction(input.tx)
            : this.pagoClienteRepository;
        const { operacion } = input;

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId, input.gymId);
            return;
        }

        const pagoCliente = this.mapPayloadToPagoCliente(input);
        await repo.upsertPagoCliente(pagoCliente);
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
            // R5.3: snapshot del descuento (tolera null/payloads legacy).
            precio_lista_snapshot: payload.precio_lista_snapshot === null || payload.precio_lista_snapshot === undefined
                ? null
                : Number(payload.precio_lista_snapshot),
            descuento_pct_snapshot: (payload.descuento_pct_snapshot as string | null) ?? null,
            descuento_monto_snapshot: payload.descuento_monto_snapshot === null || payload.descuento_monto_snapshot === undefined
                ? null
                : Number(payload.descuento_monto_snapshot),
            // Condonación del recargo por mora (docs/RECARGO_MORA.md §6-bis).
            // Sin esto el cierre remoto no puede mostrar cuánto se perdonó ni
            // quién lo autorizó: el rastro se perdía al subir el cobro.
            recargo_mora_condonado_importe:
                (payload.recargo_mora_condonado_importe as string | null) ?? null,
            recargo_mora_condonado_motivo:
                (payload.recargo_mora_condonado_motivo as string | null) ?? null,
            recargo_mora_condonado_por:
                (payload.recargo_mora_condonado_por as string | null) ?? null,
            // R5.6: el cobrador viaja congelado desde quien cobró. Perderlo
            // aquí dejaría el cierre remoto sin poder decir quién recibió el
            // dinero, que es justo lo que este corte viene a arreglar.
            ...frozenCollectorColumns(payload),
            gym_id: input.gymId,
            source_device: input.deviceId,
            version: (payload.version as number) ?? 1,
            created_at: payload.created_at
                ? new Date(String(payload.created_at))
                : trustedClock.nowUtc(),
            updated_at: trustedClock.nowUtc(),
            is_deleted: false,
            deleted_at: null
        };
    }
}
