import { UserRepository } from "../../../domain/repositories/UserRepository";
import { LoginUserDTO } from "../../dtos/AuthDTO";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env";

export class LoginUserUseCase {
    constructor(private userRepository: UserRepository) { }

    async execute(dto: LoginUserDTO): Promise<{ token: string; user_id: string; role: string }> {
        const user = await this.userRepository.findByEmail(dto.email);
        if (!user) {
            throw new Error("Invalid credentials");
        }

        const isValid = await bcrypt.compare(dto.password, user.password);
        if (!isValid) {
            throw new Error("Invalid credentials");
        }

        const token = jwt.sign(
            { user_id: user.user_id, role: user.role },
            env.jwtSecret || "secret",
            { expiresIn: "12h" }
        );

        return { token, user_id: user.user_id, role: user.role };
    }
}
