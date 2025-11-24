import type { Moneda } from "../entities/Moneda";

export interface MonedaRepository {
    upsertMoneda(data: Moneda): Promise<void>;
    findAll(): Promise<Moneda[]>;
    findById(id: string): Promise<Moneda | null>;
    create(data: Moneda): Promise<void>;
    update(id: string, data: Partial<Moneda>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
