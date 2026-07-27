import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";
import { User } from "@prisma/client";

export interface UserRepository extends SyncTransactionalRepository<UserRepository> {
    findAll(gymId: string): Promise<User[]>;
    findByEmail(email: string): Promise<User | null>;
    findById(id: string, gymId: string): Promise<User | null>;
    create(data: Partial<User>, gymId: string): Promise<User>;
    update(id: string, gymId: string, data: Partial<User>): Promise<User>;
    upsertFromSync(data: User): Promise<User>;
    softDelete(id: string, gymId: string): Promise<void>;
}


