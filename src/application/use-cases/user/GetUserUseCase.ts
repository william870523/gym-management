import { UserRepository } from "../../../domain/repositories/UserRepository";
import { User } from "@prisma/client";

export class GetUserUseCase {
    constructor(private readonly userRepository: UserRepository) { }

    async execute(id: string, gymId: string): Promise<User | null> {
        return this.userRepository.findById(id, gymId);
    }
}
