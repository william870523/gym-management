// src/domain/repositories/SyncLogRepository.ts

export interface SyncLogRecord {
  eventId: string;
  entidad: string;
  operacion: "INSERT" | "UPDATE" | "DELETE";
  entidadId: string;
  gymId: string;
  deviceId: string;
  payload: Record<string, unknown>;
}

export interface SyncLogRepository {
  exists(eventId: string): Promise<boolean>;
  register(record: SyncLogRecord): Promise<void>;
}
