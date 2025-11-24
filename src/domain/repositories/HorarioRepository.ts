import type { Horario } from "../entities/Horario";

export interface HorarioRepository {
    upsertHorario(data: Horario): Promise<void>;
    findAll(): Promise<Horario[]>;
    findById(id: string): Promise<Horario | null>;
    create(data: Horario): Promise<void>;
    update(id: string, data: Partial<Horario>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
