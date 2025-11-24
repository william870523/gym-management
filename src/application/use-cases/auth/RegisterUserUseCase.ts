import { UserRepository } from "../../../domain/repositories/UserRepository";
import { RegisterUserDTO } from "../../dtos/AuthDTO";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

export class RegisterUserUseCase {
    constructor(private userRepository: UserRepository) { }

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
            createdAt: new Date(),
            is_deleted: false,
            created_at: new Date(),
            updated_at: new Date(),
            version: 1
        });

        return {
            user_id: newUser.user_id,
            email: newUser.user_email,
            role: newUser.role
        };
    }
}
