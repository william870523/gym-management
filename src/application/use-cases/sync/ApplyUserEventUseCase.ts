import type { SyncTransactionContext } from "./sync-transaction";

import type { User } from "@prisma/client";
import type { SyncEventPayload, SyncOperacion } from "../../../domain/entities/SyncEvent";
import type { UserRepository } from "../../../domain/repositories/UserRepository";

export interface ApplyUserEventInput {
    eventId: string;
    entidadId: string;
    operacion: SyncOperacion;
    gymId: string;
    deviceId: string;
    payload: SyncEventPayload;
    /** Contexto transaccional del upload (Unidad 01). */
    tx?: SyncTransactionContext;
}

export class ApplyUserEventUseCase {
    constructor(
        private readonly userRepository: UserRepository
    ) { }

    async execute(input: ApplyUserEventInput): Promise<{ processed: boolean }> {
        const repo = input.tx
            ? this.userRepository.withTransaction(input.tx)
            : this.userRepository;
        const { operacion } = input;

        if (operacion === "DELETE") {
            await repo.softDelete(input.entidadId, input.gymId);
        } else {
            const user = this.mapPayloadToUser(input);
            await repo.upsertFromSync(user);
        }

        return { processed: true };
    }

    private mapPayloadToUser(input: ApplyUserEventInput): User {
        const payload = input.payload as Record<string, unknown>;

        // We MUST cast everything safely because payload is unknown
        return {
            user_id: input.entidadId,
            user_nombre: String(payload.user_nombre),
            user_email: String(payload.user_email),
            password: String(payload.password),
            role: String(payload.role || 'user'),
            active: payload.active !== undefined ? Boolean(payload.active) : true,
            is_deleted: Boolean(payload.is_deleted),
            created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            gym_id: input.gymId,
            // El nivel de Dueño de la cadena viaja con el usuario para que se le
            // reconozca desde cualquier sede (docs/MULTI_SEDE.md §3). Ausente en
            // un evento antiguo significa `false`: la autoridad no se hereda por
            // omisión ni se regala al sincronizar.
            es_plataforma: Boolean(payload.es_plataforma),
            source_device: input.deviceId,
            version: (payload.version as number) ?? 1,
            updated_at: payload.updated_at ? new Date(String(payload.updated_at)) : new Date(),
            deleted_at: payload.deleted_at ? new Date(String(payload.deleted_at)) : null
        };
    }
}
