import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";
import type { PlanesPago } from "../entities/PlanesPago";

export interface PlanesPagoRepository extends SyncTransactionalRepository<PlanesPagoRepository> {
    upsertPlanesPago(data: PlanesPago): Promise<void>;
    findAll(gymId: string): Promise<PlanesPago[]>;
    findById(id: string, gymId: string): Promise<PlanesPago | null>;
    create(data: PlanesPago, gymId: string): Promise<void>;
    update(id: string, gymId: string, data: Partial<PlanesPago>): Promise<void>;
    softDelete(id: string, gymId: string): Promise<void>;
}
