import type { Entrenador } from "../../../domain/entities/Entrenador";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";

export interface ApplyEntrenadorEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
}

export class ApplyEntrenadorEventUseCase {
    constructor(
        private readonly entrenadorRepository: EntrenadorRepository
    ) { }

    async execute(input: ApplyEntrenadorEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            return;
        }

        const entrenador = this.mapPayloadToEntrenador(input);
        await this.entrenadorRepository.upsertEntrenador(entrenador);
    }

    private mapPayloadToEntrenador(input: ApplyEntrenadorEventInput): Entrenador {
        const payload = input.payload as Record<string, unknown>;

        return {
            id_entrenador: input.entidadId,
            ci_entrenador: String(payload.ci_entrenador),
            nombres_entrenador: String(payload.nombres_entrenador),
            apellidos_entrenador: String(payload.apellidos_entrenador),
            sexo_entrenador: String(payload.sexo_entrenador),
            foto_entrenador: payload.foto_entrenador ? Buffer.from(String(payload.foto_entrenador), 'base64') : null,
            direccion_entrenador: (payload.direccion_entrenador as string | null) ?? null,
            telefono_entrenador: payload.telefono_entrenador ? Number(payload.telefono_entrenador) : null,
            correo_entrenador: (payload.correo_entrenador as string | null) ?? null,
            activo_entrenador: Boolean(payload.activo_entrenador),
            fecha_incio_entrenador: new Date(String(payload.fecha_incio_entrenador)),
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
