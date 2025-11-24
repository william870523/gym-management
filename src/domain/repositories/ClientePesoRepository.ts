import type { ClientePeso } from "../entities/ClientePeso";

export interface ClientePesoRepository {
    upsertClientePeso(data: ClientePeso): Promise<void>;
    findAll(): Promise<ClientePeso[]>;
    findById(id: string): Promise<ClientePeso | null>;
    create(data: ClientePeso): Promise<void>;
    update(id: string, data: Partial<ClientePeso>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
