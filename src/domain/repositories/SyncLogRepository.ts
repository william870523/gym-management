// src/domain/repositories/SyncLogRepository.ts

export interface SyncLogRecord {
  eventId: string;
  entidad: string;
  operacion: "INSERT" | "UPDATE" | "DELETE";
  entidadId: string;
  gymId: string | null;
  deviceId: string;
  payload: Record<string, unknown>;
}

export interface SyncLogRepository {
  exists(eventId: string): Promise<boolean>;
  register(record: SyncLogRecord): Promise<void>;
  findChanges(
    cursor: { afterId?: number; since?: Date },
    untilId: number,
    gymId: string,
  ): Promise<any[]>;
}
