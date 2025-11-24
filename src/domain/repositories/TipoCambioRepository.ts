import type { TipoCambio } from "../entities/TipoCambio";

export interface TipoCambioRepository {
    upsertTipoCambio(data: TipoCambio): Promise<void>;
    findAll(): Promise<TipoCambio[]>;
    findById(id: string): Promise<TipoCambio | null>;
    create(data: TipoCambio): Promise<void>;
    update(id: string, data: Partial<TipoCambio>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
