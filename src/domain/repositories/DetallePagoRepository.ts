import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";
import type { DetallePago } from "../entities/DetallePago";

export interface DetallePagoRepository extends SyncTransactionalRepository<DetallePagoRepository> {
    upsertDetallePago(data: DetallePago): Promise<void>;
    findAll(gymId: string): Promise<DetallePago[]>;
    findById(id: string, gymId: string): Promise<DetallePago | null>;
    create(data: DetallePago): Promise<void>;
    update(id: string, gymId: string, data: Partial<DetallePago>): Promise<void>;
    softDelete(id: string, gymId: string): Promise<void>;
}
