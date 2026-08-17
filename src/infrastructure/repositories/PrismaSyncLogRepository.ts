// src/infrastructure/repositories/PrismaSyncLogRepository.ts
import type {
  SyncLogRecord,
  SyncLogRepository,
  SyncLogTransactionContext,
} from "../../domain/repositories/SyncLogRepository";
import { serialize } from "../../shared/utils/serialize";
import { prisma } from "../db/prismaClient";

export class PrismaSyncLogRepository implements SyncLogRepository {
  constructor(private readonly syncLogDelegate: any = prisma.syncLog) {}

  // Devuelve el delegado ligado a la transacción en curso, si la hay.
  private delegate(tx?: SyncLogTransactionContext) {
    return tx?.syncLog ?? this.syncLogDelegate;
  }

  // Verifica si un evento ya fue registrado previamente.
  async exists(eventId: string, tx?: SyncLogTransactionContext): Promise<boolean> {
    const record = await this.delegate(tx).findUnique({ where: { event_id: eventId } });
    return Boolean(record);
  }

  // Inserta el evento en la tabla de sync_log para dejar trazabilidad.
  async register(record: SyncLogRecord, tx?: SyncLogTransactionContext): Promise<void> {
    await this.delegate(tx).create({
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
    const events = await this.syncLogDelegate.findMany({
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
          {
            // Eventos globales: los recibe cualquier instalación.
            //
            // `gym` estaba emitiéndose como global desde siempre —la edición de
            // una sede escribe `gym_id: null`— pero **nadie lo descargaba**,
            // porque no figuraba aquí. Con multi-sede eso deja de ser un detalle:
            // una sede creada en la web jamás llegaría a los escritorios.
            //
            // `user` viaja como global SOLO cuando se emite a propósito con
            // `gym_id: null`, que hoy es el caso del **Dueño de la cadena**: su
            // nivel debe reconocerse al entrar desde cualquier sede. Las altas y
            // ediciones normales llevan su `gym_id` y siguen siendo de su sede.
            //
            // Precio de entrada, aprendido por las malas el 27-07: exige que la
            // misma persona tenga **el mismo `user_id` en las dos bases**. Si no,
            // el correo único hace chocar el evento (P2002) y **bloquea la cola
            // entera** por el orden estricto. Herramienta:
            // `repair:user-identity` en `gym-local-api`, que informa antes de
            // escribir.
            gym_id: null,
            entidad: {
              in: [
                "gym",
                "user",
                "moneda",
                "monedas",
                "nacionalidad",
                "nacionalidades",
                "tipo_pago",
                "tipo_cambio",
                "referencia",
                // M4a: el precio del plus es catálogo de la cadena, y la marca
                // de un socio tiene que llegar a TODAS las sedes —no solo a la
                // suya— o la sede visitada no sabría que puede dejarle entrar
                // (docs/MULTI_SEDE.md §9-bis).
                "acceso_multisede_precio",
                "cliente_acceso_multisede",
                "cliente_visitante",
              ],
            },
          },
        ]
      },
      orderBy: { id: "asc" },
      take: 1000
    });

    return events.map((e: any) => ({
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
