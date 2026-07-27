import type { SyncTransactionContext } from "./sync-transaction";
import type { Referencia } from "../../../domain/entities/Referencia";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { ReferenciaRepository } from "../../../domain/repositories/ReferenciaRepository";

export interface ApplyReferenciaEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyReferenciaEventUseCase {
    constructor(
        private readonly referenciaRepository: ReferenciaRepository
    ) { }

    async execute(input: ApplyReferenciaEventInput): Promise<void> {
        const repo = input.tx
            ? this.referenciaRepository.withTransaction(input.tx)
            : this.referenciaRepository;
        const { operacion } = input;

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId);
            return;
        }

        const referencia = this.mapPayloadToReferencia(input);
        await repo.upsertReferencia(referencia);
    }

    private mapPayloadToReferencia(input: ApplyReferenciaEventInput): Referencia {
        const payload = input.payload as Record<string, unknown>;

        return {
            referencia_id: input.entidadId,
            nombre_referencia: String(payload.nombre_referencia),
            version: (payload.version as number) ?? 1,
            created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            updated_at: new Date(),
            is_deleted: false,
            deleted_at: null
        };
    }
}
