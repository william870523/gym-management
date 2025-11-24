import type { Asistencia } from "../entities/Asistencia";

export interface AsistenciaRepository {
    upsertAsistencia(data: Asistencia): Promise<void>;
    findAll(): Promise<Asistencia[]>;
    findById(id: string): Promise<Asistencia | null>;
    create(data: Asistencia): Promise<void>;
    update(id: string, data: Partial<Asistencia>): Promise<void>;
    softDelete(id: string): Promise<void>;
}
