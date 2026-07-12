import { v4 as uuidv4 } from "uuid";
import { UserRepository } from "../../../domain/repositories/UserRepository";
import { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeleteUserUseCase {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string): Promise<void> {
        const existing = await this.userRepository.findById(id);
        if (!existing) {
            throw new Error("User not found");
        }

        await this.userRepository.softDelete(id);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: uuidv4(),
            entidad: "user",
            operacion: "DELETE",
            entidadId: id,
            gymId: existing.gym_id ?? null,
            deviceId: "WEB_ADMIN",
            payload: { user_id: id }
        });
    }
}
