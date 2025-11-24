import type { Asistencia } from "../../../domain/entities/Asistencia";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";

export interface ApplyAsistenciaEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
}

export class ApplyAsistenciaEventUseCase {
    constructor(
        private readonly asistenciaRepository: AsistenciaRepository
    ) { }

    async execute(input: ApplyAsistenciaEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            // TODO: Implementar softDelete si es necesario
            return;
        }

        const asistencia = this.mapPayloadToAsistencia(input);
        await this.asistenciaRepository.upsertAsistencia(asistencia);
    }

    private mapPayloadToAsistencia(input: ApplyAsistenciaEventInput): Asistencia {
        const payload = input.payload as Record<string, unknown>;

        return {
            asistencia_id: input.entidadId,
            ci: String(payload.ci),
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
