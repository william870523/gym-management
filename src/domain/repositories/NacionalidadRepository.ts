import type { Nacionalidad } from "../entities/Nacionalidad";

export interface NacionalidadRepository {
    upsertNacionalidad(data: Nacionalidad): Promise<void>;
    findAll(): Promise<Nacionalidad[]>;
    findById(id: string): Promise<Nacionalidad | null>;
    create(data: Nacionalidad): Promise<void>;
    update(id: string, data: Partial<Nacionalidad>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
