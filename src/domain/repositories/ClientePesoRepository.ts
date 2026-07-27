import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";
import type { ClientePeso } from "../entities/ClientePeso";

export interface ClientePesoRepository extends SyncTransactionalRepository<ClientePesoRepository> {
    upsertClientePeso(data: ClientePeso): Promise<void>;
    findAll(gymId: string, ci?: string): Promise<ClientePeso[]>;
    findById(id: string, gymId: string): Promise<ClientePeso | null>;
    create(data: ClientePeso): Promise<void>;
    update(id: string, gymId: string, data: Partial<ClientePeso>): Promise<void>;
    softDelete(id: string, gymId: string): Promise<void>;
}
