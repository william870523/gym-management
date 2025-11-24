import type { DetallePago } from "../entities/DetallePago";

export interface DetallePagoRepository {
    upsertDetallePago(data: DetallePago): Promise<void>;
    findAll(): Promise<DetallePago[]>;
    findById(id: string): Promise<DetallePago | null>;
    create(data: DetallePago): Promise<void>;
    update(id: string, data: Partial<DetallePago>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
