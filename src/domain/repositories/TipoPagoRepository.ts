import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";
import type { TipoPago } from "../entities/TipoPago";

export interface TipoPagoRepository extends SyncTransactionalRepository<TipoPagoRepository> {
    upsertTipoPago(data: TipoPago): Promise<void>;
    findAll(): Promise<TipoPago[]>;
    findById(id: string): Promise<TipoPago | null>;
    create(data: TipoPago): Promise<void>;
    update(id: string, data: Partial<TipoPago>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
