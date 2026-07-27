import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";
import type { Cuenta } from "../entities/Cuenta";

export interface CuentaRepository extends SyncTransactionalRepository<CuentaRepository> {
    upsertCuenta(data: Cuenta): Promise<void>;
    findAll(gymId: string): Promise<Cuenta[]>;
    findById(id: string, gymId: string): Promise<Cuenta | null>;
    create(data: Cuenta, gymId: string): Promise<void>;
    update(id: string, gymId: string, data: Partial<Cuenta>): Promise<void>;
    softDelete(id: string, gymId: string): Promise<void>;
}
