import type { SyncTransactionContext } from "./sync-transaction";
import type { Gym } from "../../../domain/entities/Gym";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { PrismaGymRepository } from "../../../infrastructure/repositories/PrismaGymRepository";
import { trustedClock } from "../../../config/trusted-clock";

export interface ApplyGymEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyGymEventUseCase {
    constructor(
        private readonly gymRepository: PrismaGymRepository
    ) { }

    async execute(input: ApplyGymEventInput): Promise<void> {
        const repo = input.tx
            ? this.gymRepository.withTransaction(input.tx)
            : this.gymRepository;
        const { operacion } = input;

        if (!input.gymId) {
            throw new Error(
                `No se puede sincronizar el gimnasio ${input.entidadId}: ` +
                "el JWT no declara gimnasio."
            );
        }

        // Una instalación manda eventos de sede en dos casos legítimos, y solo
        // dos (docs/MULTI_SEDE.md §3):
        //
        //  1. mantiene **su propia** sede: nombre, dirección, zona horaria;
        //  2. el **Dueño de la cadena** da de alta una sede NUEVA desde el
        //     escritorio (decisión del dueño del 26-07-2026: se hace desde los
        //     dos destinos).
        //
        // El segundo caso es el que faltaba: hasta el 27-07 se exigía
        // `entidadId === gymId` y una sede nueva, por definición, tiene otro
        // identificador. El alta se creaba en local y el remoto la rechazaba.
        //
        // Lo que **sigue prohibido** es tocar una sede ajena que ya existe: eso
        // permitiría a un dispositivo renombrar o dar de baja el gimnasio de
        // otra sede de la cadena. Crear una que no existe es aditivo y no puede
        // pisar datos de nadie.
        const esPropia = input.entidadId === input.gymId;

        // La baja de una sede ajena se comprueba antes que nada para que el
        // motivo del rechazo sea el suyo y no el genérico: exige demostrar la
        // autoridad de Dueño, y este canal autentica al DISPOSITIVO, no a la
        // persona. Se hace desde la web, donde el token sí prueba quién la
        // pide, y llega al escritorio por descarga.
        if (operacion === "DELETE" && !esPropia) {
            throw new Error(
                `No se puede dar de baja el gimnasio ${input.entidadId} por sincronización: ` +
                "la baja de una sede ajena se hace desde la web."
            );
        }

        if (!esPropia && await repo.exists(input.entidadId)) {
            throw new Error(
                `No se puede sincronizar el gimnasio ${input.entidadId}: ` +
                "una instalación solo modifica su propia sede."
            );
        }

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId);
            return;
        }

        const gym = this.mapPayloadToGym(input);
        await repo.upsertGym(gym);
    }

    private mapPayloadToGym(input: ApplyGymEventInput): Gym {
        const payload = input.payload as Record<string, unknown>;

        // Ensure payload fields match Gym entity requirements
        return {
            gym_id: input.entidadId,
            codigo: String(payload.codigo || ''), // Should be present
            nombre: String(payload.nombre || ''),
            direccion: payload.direccion ? String(payload.direccion) : null,
            ciudad: payload.ciudad ? String(payload.ciudad) : null,
            provincia: payload.provincia ? String(payload.provincia) : null,
            pais: payload.pais ? String(payload.pais) : null,
            codigo_postal: payload.codigo_postal ? String(payload.codigo_postal) : null,
            timezone: payload.timezone ? String(payload.timezone) : null,
            activo: payload.activo === true || payload.activo === 1,
            created_at: payload.created_at ? new Date(String(payload.created_at)) : null,
            updated_at: trustedClock.nowUtc(),
            deleted_at: payload.deleted_at ? new Date(String(payload.deleted_at)) : null
        };
    }
}
