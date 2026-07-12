import type { Asistencia } from "../entities/Asistencia";

export interface AsistenciaRepository {
    upsertAsistencia(data: Asistencia): Promise<void>;
    findAll(skip?: number, take?: number): Promise<Asistencia[]>;
    findActive(skip?: number, take?: number): Promise<Asistencia[]>;
    findToday(gymId?: string | null): Promise<Asistencia[]>;
    findById(id: string): Promise<Asistencia | null>;
    create(data: Asistencia): Promise<void>;
    update(id: string, data: Partial<Asistencia>): Promise<void>;
    finalize(id: string, fechaSalida: Date): Promise<Asistencia>;
    softDelete(id: string): Promise<void>;
}
