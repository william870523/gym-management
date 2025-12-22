
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
}

export class ApplyUserEventUseCase {
    constructor(
        private readonly userRepository: UserRepository
    ) { }

    async execute(input: ApplyUserEventInput): Promise<{ processed: boolean }> {
        const { operacion } = input;

        if (operacion === "DELETE") {
            await this.userRepository.softDelete(input.entidadId);
        } else {
            const user = this.mapPayloadToUser(input);
            await this.userRepository.upsertFromSync(user);
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
            is_deleted: Boolean(payload.is_deleted),
            createdAt: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            created_at: payload.created_at ? new Date(String(payload.created_at)) : new Date(),
            gym_id: (payload.gym_id as string | null) ?? input.gymId,
            source_device: (payload.source_device as string | null) ?? input.deviceId,
            version: (payload.version as number) ?? 1,
            updated_at: payload.updated_at ? new Date(String(payload.updated_at)) : new Date(),
            deleted_at: payload.deleted_at ? new Date(String(payload.deleted_at)) : null
        };
    }
}
