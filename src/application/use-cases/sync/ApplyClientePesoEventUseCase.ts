import type { SyncTransactionContext } from "./sync-transaction";
import type { ClientePeso } from "../../../domain/entities/ClientePeso";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { ClientePesoRepository } from "../../../domain/repositories/ClientePesoRepository";

export interface ApplyClientePesoEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyClientePesoEventUseCase {
    constructor(
        private readonly clientePesoRepository: ClientePesoRepository
    ) { }

    async execute(input: ApplyClientePesoEventInput): Promise<void> {
        const repo = input.tx
            ? this.clientePesoRepository.withTransaction(input.tx)
            : this.clientePesoRepository;
        const { operacion } = input;

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId, input.gymId);
            return;
        }

        const clientePeso = this.mapPayloadToClientePeso(input);
        await repo.upsertClientePeso(clientePeso);
    }

    private mapPayloadToClientePeso(input: ApplyClientePesoEventInput): ClientePeso {
        const payload = input.payload as Record<string, unknown>;

        return {
            cliente_peso_id: input.entidadId,
            ci: String(payload.ci),
            fecha: new Date(String(payload.fecha)),
            peso: Number(payload.peso),
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
