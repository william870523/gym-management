import { UserRepository } from "../../../domain/repositories/UserRepository";
import { User } from "@prisma/client";

export class ListUsersUseCase {
    constructor(private readonly userRepository: UserRepository) { }

    async execute(gymId: string): Promise<User[]> {
        return this.userRepository.findAll(gymId);
    }
}

