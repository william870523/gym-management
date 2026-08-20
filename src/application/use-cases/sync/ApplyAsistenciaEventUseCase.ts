import type { SyncTransactionContext } from "./sync-transaction";
import type { Asistencia } from "../../../domain/entities/Asistencia";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { AsistenciaRepository } from "../../../domain/repositories/AsistenciaRepository";
import { trustedClock } from "../../../config/trusted-clock";

export interface ApplyAsistenciaEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyAsistenciaEventUseCase {
    constructor(
        private readonly asistenciaRepository: AsistenciaRepository
    ) { }

    async execute(input: ApplyAsistenciaEventInput): Promise<void> {
        const repo = input.tx
            ? this.asistenciaRepository.withTransaction(input.tx)
            : this.asistenciaRepository;
        const { operacion } = input;

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId, input.gymId);
            return;
        }

        const asistencia = this.mapPayloadToAsistencia(input);
        await repo.upsertAsistencia(asistencia);
    }

    private mapPayloadToAsistencia(input: ApplyAsistenciaEventInput): Asistencia {
        const payload = input.payload as Record<string, unknown>;

        return {
            asistencia_id: input.entidadId,
            ci: String(payload.ci),
            fecha_salida: payload.fecha_salida ? new Date(String(payload.fecha_salida)) : null,
            gym_id: input.gymId,
            source_device: input.deviceId,
            version: (payload.version as number) ?? 1,
            created_at: payload.created_at
                ? new Date(String(payload.created_at))
                : trustedClock.nowUtc(),
            updated_at: trustedClock.nowUtc(),
            is_deleted: false,
            deleted_at: null,
            pausa_inicio: payload.pausa_inicio
                ? new Date(String(payload.pausa_inicio))
                : null,
            pausa_ms: typeof payload.pausa_ms === "number" ? payload.pausa_ms : 0,
            // §5.2 — el rastro de con qué decidió la sede viaja con la entrada.
            // Este mapa es una lista blanca: lo que no se nombre aquí se pierde
            // en la subida, y la fila del concentrador quedaría distinta de la
            // de la sede que la creó.
            decidido_con: textoONulo(payload.decidido_con),
            conocimiento_al_decidir: textoONulo(payload.conocimiento_al_decidir),
            dias_sin_noticias:
                typeof payload.dias_sin_noticias === "number"
                    ? payload.dias_sin_noticias
                    : null,
            conocimiento_origen_al_decidir: textoONulo(
                payload.conocimiento_origen_al_decidir,
            ),
            dias_sin_noticias_origen:
                typeof payload.dias_sin_noticias_origen === "number"
                    ? payload.dias_sin_noticias_origen
                    : null
        };
    }
}

/** Texto no vacío del payload, o `null`. Un `""` que llegara sería «no consta». */
function textoONulo(valor: unknown): string | null {
    const texto = String(valor ?? "").trim();
    return texto ? texto : null;
}
