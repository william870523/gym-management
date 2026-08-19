import type { SyncTransactionContext } from "./sync-transaction";
import type { PagoCliente } from "../../../domain/entities/PagoCliente";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { PagoClienteRepository } from "../../../domain/repositories/PagoClienteRepository";
import { trustedClock } from "../../../config/trusted-clock";
import {
    collectorColumns,
    frozenActorFromSyncPayload,
} from "../../payment/payment-actor";
import { normalizeMoney } from "../../../domain/money";
import {
    atribuirCobro,
    type AtribucionDeCobro,
} from "../../../domain/atribucion-de-cobro-policy";

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
    /**
     * M4c — resuelve si el socio está autorizado a que el ingreso se atribuya a
     * la sede que el payload declara: pertenece a ella y tiene el plus vigente.
     * Se comprueba contra la base, nunca contra el payload.
     *
     * Se inyecta en vez de consultarse aquí para que este caso de uso siga
     * siendo el que aplica el evento y no el que decide quién es quién.
     */
    resolverSocioAutorizado?: (input: {
        ci: string;
        gymIdDeclarado: string;
    }) => Promise<boolean>;
}

/** Rechazo de atribución: el evento va a cuarentena, no se «corrige». */
export class AtribucionDeCobroError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AtribucionDeCobroError";
    }
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

        // M4c — **el ingreso no se reescribe.** Antes se sellaba `gym_id` con la
        // sede del dispositivo sin preguntar, así que un cobro hecho en otra
        // sede llegaba convertido en ingreso de quien lo subía: sin error y sin
        // rastro. Ahora se decide, y ante cualquier incoherencia se rechaza
        // para que el evento se vea en la cuarentena (§7.10).
        const payload = input.payload as Record<string, unknown>;
        const decision = atribuirCobro({
            gymIdDelDispositivo: input.gymId,
            gymIdDeclaradoDelIngreso: payload.gym_id,
            cobradoEnDeclarado: payload.cobrado_en_gym_id,
            socioAutorizadoEnLaSedeDeclarada:
                String(payload.gym_id ?? "").trim() &&
                String(payload.gym_id).trim() !== input.gymId
                    ? await (input.resolverSocioAutorizado?.({
                          ci: String(payload.ci ?? "").trim(),
                          gymIdDeclarado: String(payload.gym_id).trim(),
                      }) ?? Promise.resolve(false))
                    : true,
        });
        if (!decision.ok) throw new AtribucionDeCobroError(decision.motivo);

        const pagoCliente = this.mapPayloadToPagoCliente(input, decision.atribucion);
        await repo.upsertPagoCliente(pagoCliente);
    }

    private mapPayloadToPagoCliente(
        input: ApplyPagoClienteEventInput,
        atribucion: AtribucionDeCobro,
    ): PagoCliente {
        const payload = input.payload as Record<string, unknown>;

        return {
            pago_cliente_id: input.entidadId,
            ci: String(payload.ci),
            fecha: new Date(String(payload.fecha)),
            monto_total: normalizeMoney(payload.monto_total as any),
            id_entrenador: (payload.id_entrenador as string | null) ?? null,
            id_planes_pago: String(payload.id_planes_pago),
            moneda_id: String(payload.moneda_id),
            // R5.3: snapshot del descuento (tolera null/payloads legacy).
            precio_lista_snapshot: payload.precio_lista_snapshot === null || payload.precio_lista_snapshot === undefined
                ? null
                : normalizeMoney(payload.precio_lista_snapshot as any),
            descuento_pct_snapshot: (payload.descuento_pct_snapshot as string | null) ?? null,
            descuento_monto_snapshot: payload.descuento_monto_snapshot === null || payload.descuento_monto_snapshot === undefined
                ? null
                : normalizeMoney(payload.descuento_monto_snapshot as any),
            categoria_cliente_snapshot:
                (payload.categoria_cliente_snapshot as string | null) ?? null,
            plan_codigo_snapshot:
                (payload.plan_codigo_snapshot as string | null) ?? null,
            cuota_sufijo_snapshot:
                (payload.cuota_sufijo_snapshot as string | null) ?? null,
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
            // La sede DUEÑA del ingreso, que no siempre es la del dispositivo.
            gym_id: atribucion.gymIdDelIngreso,
            // Y dónde entró el efectivo. Nulo en el cobro corriente: ahí las
            // dos son la misma y guardar el dato borraría la diferencia entre
            // «no aplica» y «coincide».
            cobrado_en_gym_id:
                atribucion.clase === "POR_CUENTA_AJENA"
                    ? atribucion.cobradoEnGymId
                    : null,
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
