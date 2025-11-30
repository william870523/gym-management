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
}

export class ApplyClientePesoEventUseCase {
    constructor(
        private readonly clientePesoRepository: ClientePesoRepository
    ) { }

    async execute(input: ApplyClientePesoEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            await this.clientePesoRepository.softDelete(input.entidadId);
            return;
        }

        const clientePeso = this.mapPayloadToClientePeso(input);
        await this.clientePesoRepository.upsertClientePeso(clientePeso);
    }

    private mapPayloadToClientePeso(input: ApplyClientePesoEventInput): ClientePeso {
        const payload = input.payload as Record<string, unknown>;

        return {
            cliente_peso_id: input.entidadId,
            ci: String(payload.ci),
            fecha: new Date(String(payload.fecha)),
            peso: Number(payload.peso),
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
