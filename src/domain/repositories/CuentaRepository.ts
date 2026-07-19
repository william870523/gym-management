import type { Cuenta } from "../entities/Cuenta";

export interface CuentaRepository {
    upsertCuenta(data: Cuenta): Promise<void>;
    findAll(gymId: string): Promise<Cuenta[]>;
    findById(id: string, gymId: string): Promise<Cuenta | null>;
    create(data: Cuenta): Promise<void>;
    update(id: string, gymId: string, data: Partial<Cuenta>): Promise<void>;
    softDelete(id: string, gymId: string): Promise<void>;
}
