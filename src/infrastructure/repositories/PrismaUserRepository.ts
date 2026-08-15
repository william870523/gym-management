import type { User } from "@prisma/client";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../db/prismaClient";
import { delegateFor, type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import {
    softDeleteGymScopedSyncRecord,
    upsertGymScopedSyncRecord,
} from "./gym-scoped-sync-write";

export class PrismaUserRepository implements UserRepository {
    constructor(
        private readonly userDelegate: any = prisma.user,
        private readonly usuarioSedeDelegate: any = prisma.usuarioSede,
    ) {}

    withTransaction(tx: SyncTransactionContext): PrismaUserRepository {
        return new PrismaUserRepository(
            delegateFor(tx, "user", this.userDelegate),
            delegateFor(tx, "usuarioSede", this.usuarioSedeDelegate),
        );
    }

    async findAll(gymId: string): Promise<User[]> {
        const scopedGymId = this.requireGymId(gymId);
        const memberships = await this.usuarioSedeDelegate.findMany({
            where: { gym_id: scopedGymId, activo: true, is_deleted: false },
            select: { user_id: true, rol: true },
        });
        const roleByUser = new Map<string, string>(
            memberships.map((membership: any) => [membership.user_id, membership.rol]),
        );
        const users = await this.userDelegate.findMany({
            where: {
                is_deleted: false,
                OR: [
                    { gym_id: scopedGymId },
                    { user_id: { in: [...roleByUser.keys()] } },
                ],
            }
        });
        return users.map((user: User) => ({
            ...user,
            rol_sede: roleByUser.get(user.user_id) ?? user.role,
        })) as User[];
    }

    async findByEmail(email: string): Promise<User | null> {
        return this.userDelegate.findUnique({
            where: { user_email: email }
        });
    }

    async findById(id: string, gymId: string): Promise<User | null> {
        const scopedGymId = this.requireGymId(gymId);
        const membership = await this.usuarioSedeDelegate.findFirst({
            where: {
                user_id: id,
                gym_id: scopedGymId,
                activo: true,
                is_deleted: false,
            },
            select: { rol: true },
        });
        const user = await this.userDelegate.findFirst({
            where: {
                user_id: id,
                is_deleted: false,
                OR: [
                    { gym_id: scopedGymId },
                    ...(membership ? [{ user_id: id }] : []),
                ],
            }
        });
        return user
            ? ({ ...user, rol_sede: membership?.rol ?? user.role } as User)
            : null;
    }

    async findPrimaryGymId(id: string): Promise<string | null> {
        const user = await this.userDelegate.findUnique({
            where: { user_id: id },
            select: { gym_id: true },
        });
        return user?.gym_id?.trim() || null;
    }

    async create(data: Partial<User>, gymId: string): Promise<User> {
        const now = trustedClock.nowUtc();
        return this.userDelegate.create({
            data: {
                ...data,
                gym_id: this.requireGymId(gymId),
                source_device: "WEB_ADMIN",
                created_at: data.created_at ?? now,
                updated_at: data.updated_at ?? now,
            }
        });
    }

    async update(id: string, gymId: string, data: Partial<User>): Promise<User> {
        const authenticatedGymId = this.requireGymId(gymId);
        const updateData: Record<string, unknown> = {
            ...data,
            source_device: "WEB_ADMIN",
            updated_at: data.updated_at ?? trustedClock.nowUtc(),
        };
        delete updateData.user_id;
        delete updateData.gym_id;
        const updated = await this.userDelegate.updateMany({
            where: {
                user_id: id,
                gym_id: authenticatedGymId,
                is_deleted: false,
            },
            data: updateData,
        });
        if (updated.count !== 1) throw new Error("User not found");
        const result = await this.userDelegate.findFirst({
            where: { user_id: id, gym_id: authenticatedGymId, is_deleted: false },
        });
        if (!result) throw new Error("User not found");
        return result;
    }

    async upsertFromSync(data: User): Promise<User> {
        await upsertGymScopedSyncRecord({
            delegate: this.userDelegate,
            entity: "user",
            pk: "user_id",
            id: data.user_id,
            gymId: data.gym_id,
            create: data,
            update: data,
        });
        return data;
    }

    async softDelete(id: string, gymId: string): Promise<void> {
        await softDeleteGymScopedSyncRecord({
            delegate: this.userDelegate,
            entity: "user",
            pk: "user_id",
            id,
            gymId: this.requireGymId(gymId),
            now: trustedClock.nowUtc(),
        });
    }

    private requireGymId(gymId: string) {
        const normalized = gymId.trim();
        if (!normalized) throw new Error("Gym scope required");
        return normalized;
    }

}
