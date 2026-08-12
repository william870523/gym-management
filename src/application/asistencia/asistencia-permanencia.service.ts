import { randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import { prisma } from "../../infrastructure/db/prismaClient";
import { serialize } from "../../shared/utils/serialize";

export class AsistenciaPermanenciaError extends Error {
  constructor(message: string, readonly status: 400 | 404) {
    super(message);
    this.name = "AsistenciaPermanenciaError";
  }
}

type OperacionPermanencia = "FINALIZAR" | "PAUSAR" | "REANUDAR";

/**
 * Escrituras de permanencia del mostrador remoto.
 *
 * La fila y su `sync_log` comparten deliberadamente la misma transacción: la
 * web no puede confirmar una pausa, reanudación o salida que el escritorio no
 * vaya a poder descargar después.
 */
export class AsistenciaPermanenciaService {
  constructor(
    private readonly client: Pick<typeof prisma, "$transaction"> = prisma,
    private readonly eventId: () => string = randomUUID,
  ) {}

  finalize(gymId: string, asistenciaId: string) {
    return this.mutate(gymId, asistenciaId, "FINALIZAR");
  }

  pause(gymId: string, asistenciaId: string) {
    return this.mutate(gymId, asistenciaId, "PAUSAR");
  }

  resume(gymId: string, asistenciaId: string) {
    return this.mutate(gymId, asistenciaId, "REANUDAR");
  }

  private async mutate(
    gymId: string,
    asistenciaId: string,
    operacion: OperacionPermanencia,
  ) {
    return this.client.$transaction(async (tx: any) => {
      const current = await tx.asistencia.findFirst({
        where: {
          asistencia_id: asistenciaId,
          gym_id: gymId,
          is_deleted: false,
        },
      });
      if (!current) {
        throw new AsistenciaPermanenciaError("Asistencia no encontrada", 404);
      }

      const now = trustedClock.nowUtc();
      let data: Record<string, unknown>;

      if (operacion === "PAUSAR") {
        if (current.fecha_salida) {
          throw new AsistenciaPermanenciaError(
            "La asistencia ya está finalizada",
            400,
          );
        }
        if (current.pausa_inicio) {
          throw new AsistenciaPermanenciaError(
            "La asistencia ya está en pausa",
            400,
          );
        }
        data = { pausa_inicio: now };
      } else {
        if (operacion === "REANUDAR" && !current.pausa_inicio) {
          throw new AsistenciaPermanenciaError(
            "La asistencia no está en pausa",
            400,
          );
        }

        let pausaMs = current.pausa_ms ?? 0;
        if (current.pausa_inicio) {
          pausaMs += Math.max(
            0,
            now.getTime() - current.pausa_inicio.getTime(),
          );
        }
        data = {
          pausa_inicio: null,
          pausa_ms: pausaMs,
          ...(operacion === "FINALIZAR" ? { fecha_salida: now } : {}),
        };
      }

      const changed = await tx.asistencia.updateMany({
        where: {
          asistencia_id: asistenciaId,
          gym_id: gymId,
          is_deleted: false,
        },
        data: {
          ...data,
          version: { increment: 1 },
          updated_at: now,
        },
      });
      if (changed.count !== 1) {
        throw new AsistenciaPermanenciaError("Asistencia no encontrada", 404);
      }

      const updated = await tx.asistencia.findFirst({
        where: {
          asistencia_id: asistenciaId,
          gym_id: gymId,
          is_deleted: false,
        },
      });
      if (!updated) {
        throw new AsistenciaPermanenciaError("Asistencia no encontrada", 404);
      }

      await tx.syncLog.create({
        data: {
          event_id: this.eventId(),
          entidad: "asistencia",
          operacion: "UPDATE",
          entidad_id: asistenciaId,
          gym_id: gymId,
          device_id: null,
          payload_json: JSON.stringify(serialize(updated)),
        },
      });

      return updated;
    });
  }
}
