// src/infrastructure/repositories/PrismaSyncLogRepository.ts
import type { SyncLogRecord, SyncLogRepository } from "../../domain/repositories/SyncLogRepository";
import { prisma } from "../db/prismaClient";

export class PrismaSyncLogRepository implements SyncLogRepository {
  // Verifica si un evento ya fue registrado previamente.
  async exists(eventId: string): Promise<boolean> {
    const record = await prisma.syncLog.findUnique({ where: { event_id: eventId } });
    return Boolean(record);
  }

  // Inserta el evento en la tabla de sync_log para dejar trazabilidad.
  async register(record: SyncLogRecord): Promise<void> {
    await prisma.syncLog.create({
      data: {
        event_id: record.eventId,
        entidad: record.entidad,
        operacion: record.operacion,
        entidad_id: record.entidadId,
        gym_id: record.gymId,
        device_id: record.deviceId,
        payload_json: JSON.stringify(record.payload)
      }
    });
  }
}
