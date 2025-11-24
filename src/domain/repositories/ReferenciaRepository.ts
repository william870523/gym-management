import type { Referencia } from "../entities/Referencia";

export interface ReferenciaRepository {
    upsertReferencia(data: Referencia): Promise<void>;
    findAll(): Promise<Referencia[]>;
    findById(id: string): Promise<Referencia | null>;
    create(data: Referencia): Promise<void>;
    update(id: string, data: Partial<Referencia>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
