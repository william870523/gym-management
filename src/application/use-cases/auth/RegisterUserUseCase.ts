import { UserRepository } from "../../../domain/repositories/UserRepository";
import { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { RegisterUserDTO } from "../../dtos/AuthDTO";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

export class RegisterUserUseCase {
    constructor(
        private userRepository: UserRepository,
        private syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: RegisterUserDTO): Promise<{ user_id: string; email: string; role: string }> {
        // Verificar si el email ya existe
        const existingUser = await this.userRepository.findByEmail(dto.user_email);
        if (existingUser) {
            throw new Error("Email already registered");
        }

        // Hashear password con bcrypt
        const passwordHash = await bcrypt.hash(dto.password, 10);

        // Crear usuario
        const newUser = await this.userRepository.create({
            user_id: uuidv4(),
            user_nombre: dto.user_nombre,
            user_email: dto.user_email,
            password: passwordHash,
            role: dto.role,
            is_deleted: false,
            active: true,
            created_at: new Date(),
            updated_at: new Date(),
            version: 1,
            gym_id: null
        });

        // Record for sync
        await this.syncLogRepository.register({
            eventId: uuidv4(),
            entidad: "user",
            operacion: "INSERT",
            entidadId: newUser.user_id,
            gymId: newUser.gym_id || null,
            deviceId: "WEB_ADMIN",
            payload: newUser as any
        });

        return {
            user_id: newUser.user_id,
            email: newUser.user_email,
            role: newUser.role
        };
    }
}

