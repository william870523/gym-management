import type { PlanesPago } from "../entities/PlanesPago";

export interface PlanesPagoRepository {
    upsertPlanesPago(data: PlanesPago): Promise<void>;
    findAll(): Promise<PlanesPago[]>;
    findById(id: string): Promise<PlanesPago | null>;
    create(data: PlanesPago): Promise<void>;
    update(id: string, data: Partial<PlanesPago>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
