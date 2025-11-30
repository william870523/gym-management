import { UserRepository } from "../../../domain/repositories/UserRepository";
import { LoginUserDTO } from "../../dtos/AuthDTO";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env";

export class LoginUserUseCase {
    constructor(private userRepository: UserRepository) { }

    async execute(dto: LoginUserDTO): Promise<{ user_id: string; role: string; email: string }> {
        const user = await this.userRepository.findByEmail(dto.email);
        if (!user) {
            throw new Error("Invalid credentials");
        }

        const isValid = await bcrypt.compare(dto.password, user.password);
        if (!isValid) {
            throw new Error("Invalid credentials");
        }

        return { user_id: user.user_id, role: user.role, email: user.user_email };
    }
}
