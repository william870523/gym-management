import type { SyncTransactionContext } from "./sync-transaction";
import type { Entrenador } from "../../../domain/entities/Entrenador";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";
import { normalizeBinary } from "../../../shared/utils/normalizeBinary";
import { normalizarSexo } from "../../../domain/sexo-policy";

export interface ApplyEntrenadorEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyEntrenadorEventUseCase {
    constructor(
        private readonly entrenadorRepository: EntrenadorRepository
    ) { }

    async execute(input: ApplyEntrenadorEventInput): Promise<void> {
        const repo = input.tx
            ? this.entrenadorRepository.withTransaction(input.tx)
            : this.entrenadorRepository;
        const { operacion } = input;

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId, input.gymId);
            return;
        }

        const entrenador = this.mapPayloadToEntrenador(input);
        await repo.upsertEntrenador(entrenador);
    }

    private mapPayloadToEntrenador(input: ApplyEntrenadorEventInput): Entrenador {
        const payload = input.payload as Record<string, unknown>;

        return {
            id_entrenador: input.entidadId,
            ci_entrenador: String(payload.ci_entrenador),
            tipo_documento: String(payload.tipo_documento ?? "DESCONOCIDO"),
            nombres_entrenador: String(payload.nombres_entrenador),
            apellidos_entrenador: String(payload.apellidos_entrenador),
            // Mismo criterio que el socio: se normaliza al aplicar, y lo que no se
      // entiende se conserva para que lo delate la alerta de calidad.
      sexo_entrenador:
        normalizarSexo(payload.sexo_entrenador) ??
        String(payload.sexo_entrenador),
            foto_entrenador: normalizeBinary(payload.foto_entrenador),
            direccion_entrenador: (payload.direccion_entrenador as string | null) ?? null,
            telefono_entrenador: payload.telefono_entrenador ? Number(payload.telefono_entrenador) : null,
            correo_entrenador: (payload.correo_entrenador as string | null) ?? null,
            activo_entrenador: Boolean(payload.activo_entrenador),
            fecha_incio_entrenador: new Date(String(payload.fecha_incio_entrenador)),
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
