import { v4 as uuidv4 } from "uuid";
import { UserRepository } from "../../../domain/repositories/UserRepository";
import { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class DeleteUserUseCase {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, gymId: string): Promise<void> {
        const existing = await this.userRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("User not found");
        }

        await this.userRepository.softDelete(id, gymId);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: uuidv4(),
            entidad: "user",
            operacion: "DELETE",
            entidadId: id,
            gymId,
            deviceId: "WEB_ADMIN",
            payload: { user_id: id }
        });
    }
}
