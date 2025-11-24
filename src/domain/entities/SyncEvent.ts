// src/domain/entities/SyncEvent.ts
export type SyncOperacion = "INSERT" | "UPDATE" | "DELETE";

export interface SyncEventPayload {
  [key: string]: unknown;
}

export interface SyncEvent {
  eventId: string;
  entidad: string;
  operacion: SyncOperacion;
  entidadId: string;
  gymId: string;
  deviceId: string;
  payload: SyncEventPayload;
}
