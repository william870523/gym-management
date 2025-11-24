import type { Cuenta } from "../entities/Cuenta";

export interface CuentaRepository {
    upsertCuenta(data: Cuenta): Promise<void>;
    findAll(): Promise<Cuenta[]>;
    findById(id: string): Promise<Cuenta | null>;
    create(data: Cuenta): Promise<void>;
    update(id: string, data: Partial<Cuenta>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
