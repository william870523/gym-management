import type { SyncTransactionContext } from "./sync-transaction";
import type { Moneda } from "../../../domain/entities/Moneda";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { MonedaRepository } from "../../../domain/repositories/MonedaRepository";
import { normalizeBinary } from "../../../shared/utils/normalizeBinary";

export interface ApplyMonedaEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyMonedaEventUseCase {
    constructor(
        private readonly monedaRepository: MonedaRepository
    ) { }

    async execute(input: ApplyMonedaEventInput): Promise<void> {
        const repo = input.tx
            ? this.monedaRepository.withTransaction(input.tx)
            : this.monedaRepository;
        const { operacion } = input;

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId);
            return;
        }

        const moneda = this.mapPayloadToMoneda(input);
        await repo.upsertMoneda(moneda);
    }

    private mapPayloadToMoneda(input: ApplyMonedaEventInput): Moneda {
        const payload = input.payload as Record<string, unknown>;

        return {
            moneda_id: input.entidadId,
            moneda_nombre: String(payload.moneda_nombre),
            codigo: String(payload.codigo),
            simbolo: (payload.simbolo as string | null) ?? null,
            imagen: normalizeBinary(payload.imagen),
            version: (payload.version as number) ?? 1,
            created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            updated_at: new Date(),
            is_deleted: false,
            deleted_at: null
        };
    }
}
