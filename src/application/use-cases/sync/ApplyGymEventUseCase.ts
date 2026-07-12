import type { Gym } from "../../../domain/entities/Gym";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { PrismaGymRepository } from "../../../infrastructure/repositories/PrismaGymRepository";

export interface ApplyGymEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string; // usually null for Gym entity
    deviceId: string;
    payload: SyncEventPayload;
}

export class ApplyGymEventUseCase {
    constructor(
        private readonly gymRepository: PrismaGymRepository
    ) { }

    async execute(input: ApplyGymEventInput): Promise<void> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            await this.gymRepository.softDelete(input.entidadId);
            return;
        }

        const gym = this.mapPayloadToGym(input);
        await this.gymRepository.upsertGym(gym);
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
            updated_at: new Date(), // Always fresh on sync? Or prefer payload.updated_at
            deleted_at: payload.deleted_at ? new Date(String(payload.deleted_at)) : null
        };
    }
}
