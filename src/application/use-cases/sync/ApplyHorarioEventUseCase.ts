import type { SyncTransactionContext } from "./sync-transaction";
import type { Horario } from "../../../domain/entities/Horario";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";

export interface ApplyHorarioEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyHorarioEventUseCase {
    constructor(
        private readonly horarioRepository: HorarioRepository
    ) { }

    async execute(input: ApplyHorarioEventInput): Promise<void> {
        const { operacion } = input;
        const repo = input.tx
            ? this.horarioRepository.withTransaction(input.tx)
            : this.horarioRepository;

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId, input.gymId);
            return;
        }

        const horario = this.mapPayloadToHorario(input);
        await repo.upsertHorario(horario);
    }

    private mapPayloadToHorario(input: ApplyHorarioEventInput): Horario {
        const payload = input.payload as Record<string, unknown>;

        return {
            horario_id: input.entidadId,
            nombre_horario: String(payload.nombre_horario),
            hora_inicio: Number(payload.hora_inicio),
            hora_fin: Number(payload.hora_fin),
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
