import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { UserRepository } from "../../../domain/repositories/UserRepository";
import { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { User } from "@prisma/client";

export interface UpdateUserDTO {
    user_nombre?: string;
    user_email?: string;
    password?: string;
    role?: string;
    gym_id?: string | null;
    active?: boolean;
}

export class UpdateUserUseCase {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, dto: UpdateUserDTO): Promise<User> {
        const existing = await this.userRepository.findById(id);
        if (!existing) {
            throw new Error("User not found");
        }

        const updateData: any = { ...dto };
        if (dto.password) {
            updateData.password = await bcrypt.hash(dto.password, 10);
        } else {
            delete updateData.password;
        }

        updateData.updated_at = new Date();
        updateData.version = (existing.version ?? 0) + 1;

        const updated = await this.userRepository.update(id, updateData);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: uuidv4(),
            entidad: "user",
            operacion: "UPDATE",
            entidadId: id,
            gymId: updated.gym_id ?? null,
            deviceId: "WEB_ADMIN",
            payload: updated as any
        });

        return updated;
    }
}

