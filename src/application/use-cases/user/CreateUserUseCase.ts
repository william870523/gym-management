import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { UserRepository } from "../../../domain/repositories/UserRepository";
import { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { User } from "@prisma/client";

export interface CreateUserDTO {
    user_nombre: string;
    user_email: string;
    password?: string;
    role: string;
    gym_id?: string | null;
    active?: boolean;
}

export class CreateUserUseCase {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: CreateUserDTO): Promise<User> {
        const passwordHash = await bcrypt.hash(dto.password || "123456", 10);

        const newUser: User = await this.userRepository.create({
            user_id: uuidv4(),
            user_nombre: dto.user_nombre,
            user_email: dto.user_email,
            password: passwordHash,
            role: dto.role as any,
            gym_id: dto.gym_id ?? null,
            active: dto.active ?? true,
            is_deleted: false,
            created_at: new Date(),
            updated_at: new Date(),
            version: 1
        });

        // Record for sync
        await this.syncLogRepository.register({
            eventId: uuidv4(),
            entidad: "user",
            operacion: "INSERT",
            entidadId: newUser.user_id,
            gymId: newUser.gym_id ?? null,
            deviceId: "WEB_ADMIN",
            payload: newUser as any
        });

        return newUser;
    }
}
