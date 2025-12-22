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
        return prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: data as any
            });

            // Create SyncLog entry for synchronization
            await tx.syncLog.create({
                data: {
                    event_id: crypto.randomUUID(),
                    entidad: 'user',
                    operacion: 'INSERT',
                    entidad_id: user.user_id,
                    gym_id: user.gym_id,
                    payload_json: JSON.stringify(user)
                }
            });

            return user;
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
