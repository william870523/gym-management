import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";
import type { Asistencia } from "../entities/Asistencia";

export interface AsistenciaRepository extends SyncTransactionalRepository<AsistenciaRepository> {
    upsertAsistencia(data: Asistencia): Promise<void>;
    findAll(gymId: string, skip?: number, take?: number, ci?: string): Promise<Asistencia[]>;
    findActive(gymId: string, skip?: number, take?: number): Promise<Asistencia[]>;
    findToday(gymId: string): Promise<Asistencia[]>;
    findById(id: string, gymId: string): Promise<Asistencia | null>;
    create(data: Asistencia): Promise<void>;
    update(id: string, gymId: string, data: Partial<Asistencia>): Promise<void>;
    finalize(id: string, gymId: string, fechaSalida: Date): Promise<Asistencia>;
    softDelete(id: string, gymId: string): Promise<void>;
}
