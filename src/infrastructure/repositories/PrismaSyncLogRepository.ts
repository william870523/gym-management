// src/infrastructure/repositories/PrismaSyncLogRepository.ts
import type { SyncLogRecord, SyncLogRepository } from "../../domain/repositories/SyncLogRepository";
import { serialize } from "../../shared/utils/serialize";
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
        payload_json: JSON.stringify(serialize(record.payload))
      }
    });
  }

  async findChanges(
    cursor: { afterId?: number; since?: Date },
    untilId: number,
    gymId: string,
  ): Promise<any[]> {
    const events = await prisma.syncLog.findMany({
      where: {
        id: {
          ...(cursor.afterId !== undefined ? { gt: cursor.afterId } : {}),
          lte: untilId,
        },
        ...(cursor.afterId === undefined && cursor.since
          ? { created_at: { gt: cursor.since } }
          : {}),
        OR: [
          { gym_id: gymId },
          { gym_id: null },
          // Entidades globales siempre se sincronizan
          { entidad: 'gym' },
          { entidad: 'moneda' },
          { entidad: 'monedas' }, // Alias
          { entidad: 'planes_pago' },
        ]
      },
      orderBy: { id: "asc" },
      take: 1000
    });

    return events.map((e) => ({
      cursor_id: e.id,
      event_id: e.event_id,
      entidad: e.entidad,
      operacion: e.operacion,
      entidad_id: e.entidad_id,
      gym_id: e.gym_id,
      device_id: e.device_id,
      payload: JSON.parse(e.payload_json),
      created_at: e.created_at
    }));
  }
}
