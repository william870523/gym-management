import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { UserRepository } from "../../../domain/repositories/UserRepository";
import { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { User } from "@prisma/client";
import { trustedClock } from "../../../config/trusted-clock";

export interface CreateUserDTO {
    user_nombre: string;
    user_email: string;
    password: string;
    role: "admin" | "user";
    active?: boolean;
}

export class CreateUserUseCase {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: CreateUserDTO, gymId: string): Promise<User> {
        const authenticatedGymId = gymId.trim();
        if (!authenticatedGymId) throw new Error("Gym scope required");
        if (await this.userRepository.findByEmail(dto.user_email)) {
            throw new Error("Email already in use");
        }
        const now = trustedClock.nowUtc();
        const passwordHash = await bcrypt.hash(dto.password, 10);

        const newUser: User = await this.userRepository.create({
            user_id: uuidv4(),
            user_nombre: dto.user_nombre,
            user_email: dto.user_email,
            password: passwordHash,
            role: dto.role,
            gym_id: authenticatedGymId,
            source_device: "WEB_ADMIN",
            active: dto.active ?? true,
            is_deleted: false,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            version: 1,
        }, authenticatedGymId);

        // Record for sync
        await this.syncLogRepository.register({
            eventId: uuidv4(),
            entidad: "user",
            operacion: "INSERT",
            entidadId: newUser.user_id,
            gymId: authenticatedGymId,
            deviceId: "WEB_ADMIN",
            payload: newUser as any
        });

        return newUser;
    }
}
