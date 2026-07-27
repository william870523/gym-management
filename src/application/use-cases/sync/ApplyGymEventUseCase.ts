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

        if (!input.gymId || input.entidadId !== input.gymId) {
            throw new Error(
                `No se puede sincronizar el gimnasio ${input.entidadId}: ` +
                "el JWT pertenece a otro gimnasio."
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
