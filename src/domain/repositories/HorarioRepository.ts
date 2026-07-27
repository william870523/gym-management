import type { Horario } from "../entities/Horario";
import type { SyncTransactionalRepository } from "../../application/use-cases/sync/sync-transaction";

export interface HorarioRepository extends SyncTransactionalRepository<HorarioRepository> {
    upsertHorario(data: Horario): Promise<void>;
    findAll(gymId: string): Promise<Horario[]>;
    findById(id: string, gymId: string): Promise<Horario | null>;
    create(data: Horario, gymId: string): Promise<void>;
    update(id: string, gymId: string, data: Partial<Horario>): Promise<void>;
    softDelete(id: string, gymId: string): Promise<void>;
}
