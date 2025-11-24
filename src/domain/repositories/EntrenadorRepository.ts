import type { Entrenador } from "../entities/Entrenador";

export interface EntrenadorRepository {
    upsertEntrenador(data: Entrenador): Promise<void>;
    findAll(): Promise<Entrenador[]>;
    findById(id: string): Promise<Entrenador | null>;
    create(data: Entrenador): Promise<void>;
    update(id: string, data: Partial<Entrenador>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
