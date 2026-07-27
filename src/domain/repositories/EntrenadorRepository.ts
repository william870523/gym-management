import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";
import type { Entrenador } from "../entities/Entrenador";

export interface EntrenadorRepository extends SyncTransactionalRepository<EntrenadorRepository> {
    upsertEntrenador(data: Entrenador): Promise<void>;
    findAll(gymId: string): Promise<Entrenador[]>;
    findById(id: string, gymId: string): Promise<Entrenador | null>;
    create(data: Entrenador): Promise<void>;
    update(id: string, gymId: string, data: Partial<Entrenador>): Promise<void>;
    softDelete(id: string, gymId: string): Promise<void>;
}
