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

/**
 * Contexto transaccional opcional (Unidad 01). Cuando llega, la comprobación de
 * idempotencia y el registro del evento ocurren dentro de la misma transacción
 * que aplicó la entidad.
 */
export type SyncLogTransactionContext = Record<string, any>;

export interface SyncLogRepository {
  exists(eventId: string, tx?: SyncLogTransactionContext): Promise<boolean>;
  register(
    record: SyncLogRecord,
    tx?: SyncLogTransactionContext,
  ): Promise<void>;
  findChanges(
    cursor: { afterId?: number; since?: Date },
    untilId: number,
    gymId: string,
  ): Promise<any[]>;
}
