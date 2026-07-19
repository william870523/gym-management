import { UserRepository } from "../../../domain/repositories/UserRepository";
import { LoginUserDTO } from "../../dtos/AuthDTO";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env";

export class LoginUserUseCase {
    constructor(private userRepository: UserRepository) { }

    async execute(dto: LoginUserDTO): Promise<{
        user_id: string;
        role: string;
        email: string;
        gym_id: string | null;
    }> {
        const user = await this.userRepository.findByEmail(dto.email);
        if (!user || user.is_deleted) {
            throw new Error("Invalid credentials");
        }

        if (!user.active) {
            throw new Error("User account is inactive");
        }

        const isValid = await bcrypt.compare(dto.password, user.password);
        if (!isValid) {
            throw new Error("Invalid credentials");
        }

        return {
            user_id: user.user_id,
            role: user.role,
            email: user.user_email,
            gym_id: user.gym_id,
        };
    }
}
