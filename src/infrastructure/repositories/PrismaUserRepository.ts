import { PrismaClient, User } from "@prisma/client";
import { UserRepository } from "../../domain/repositories/UserRepository";

const prisma = new PrismaClient();

export class PrismaUserRepository implements UserRepository {
    async findByEmail(email: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { user_email: email }
        });
    }

    async findById(id: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { user_id: id }
        });
    }

    async create(data: Partial<User>): Promise<User> {
        return prisma.user.create({
            data: data as any
        });
    }
}
