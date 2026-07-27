import { UserRepository } from "../../../domain/repositories/UserRepository";
import { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { RegisterUserDTO } from "../../dtos/AuthDTO";

export class RegisterUserUseCase {
    constructor(
        private userRepository: UserRepository,
        private syncLogRepository: SyncLogRepository
    ) { }

    async execute(dto: RegisterUserDTO): Promise<{ user_id: string; email: string; role: string }> {
        void dto;
        throw new Error("PUBLIC_REGISTRATION_DISABLED");
    }
}

