import { PrismaClient, User } from "@prisma/client";
import { UserRepository } from "../../domain/repositories/UserRepository";

const prisma = new PrismaClient();

export class PrismaUserRepository implements UserRepository {
    async findAll(): Promise<User[]> {
        return prisma.user.findMany({
            where: { is_deleted: false }
        });
    }

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

    async update(id: string, data: Partial<User>): Promise<User> {
        return prisma.user.update({
            where: { user_id: id },
            data: data as any
        });
    }

    async upsertFromSync(data: User): Promise<User> {
        return prisma.user.upsert({
            where: { user_id: data.user_id },
            create: data,
            update: data
        });
    }

    async softDelete(id: string): Promise<void> {
        await prisma.user.update({
            where: { user_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
    }

}
