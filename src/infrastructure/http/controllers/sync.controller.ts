// gym-remote-api/src/infrastructure/http/controllers/sync.controller.ts
import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import { UploadEventsSchema, ChangesQuerySchema } from "../../../application/validation/sync.schemas";
import { SyncService } from "../../sync/SyncService";
import { registrarNoticiaDeLaSede } from "../../sync/noticia-de-la-sede";
import { prisma } from "../../db/prismaClient";
import { trustedClock } from "../../../config/trusted-clock";
import { logger } from "../../../config/logger";

const syncService = new SyncService();

function deviceScope(c: Context) {
  const auth = c.get("auth") as {
    sub?: string;
    deviceId?: string;
    gymId?: string;
  };
  return {
    deviceId: auth.deviceId ?? auth.sub ?? "",
    gymId: auth.gymId ?? "",
  };
}

// Maneja la carga de eventos de sincronizacion desde los clientes locales.
export async function uploadEventsController(c: Context) {
  const body = await c.req.json().catch(() => null);

  if (body && body.events && Array.isArray(body.events)) {
    const counts: Record<string, number> = {};
    for (const ev of body.events) {
      counts[ev.entidad] = (counts[ev.entidad] || 0) + 1;
    }
    console.log(`[Diagnostic Log] Remote received ${body.events.length} events:`, counts);
  } else {
    console.log(`[Diagnostic Log] Remote received invalid or empty events body`);
  }

  const parsed = UploadEventsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid payload", details: parsed.error.format() },
      400
    );
  }

  const scope = deviceScope(c);
  if (
    parsed.data.device_id !== scope.deviceId ||
    parsed.data.gym_id !== scope.gymId
  ) {
    return c.json(
      { error: "Forbidden - device synchronization scope mismatch" },
      403,
    );
  }

  try {
    const result = await syncService.uploadEvents(parsed.data);
    // Unidad 01: el cliente local solo puede marcar como enviados los IDs que
    // aquí se nombran. `processed` viaja como dato derivado, no como autoridad.
    return c.json({
      ok: true,
      accepted_event_ids: result.accepted_event_ids,
      duplicate_event_ids: result.duplicate_event_ids,
      failed_event_id: result.failed_event_id,
      processed: result.processed,
    });
  } catch (err) {
    console.error("Error in uploadEventsController", err);
    logger.error("Error in uploadEventsController", { err });

    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      ((Array.isArray(err.meta?.target) &&
        (err.meta?.target as string[]).includes("sync_log_event_id_key")) ||
        err.meta?.target === "sync_log_event_id_key")
    ) {
      return c.json(
        {
          ok: true,
          accepted_event_ids: [],
          duplicate_event_ids: [],
          failed_event_id: null,
          processed: 0,
          warning: "duplicate event_id, ignored",
        },
        200,
      );
    }

    return c.json(
      { error: "Internal error in upload-events", details: (err as Error).message },
      500
    );
  }
}

// Devuelve los cambios pendientes para un gimnasio desde sync_log.
export async function getChangesController(c: Context) {
  const query = {
    since: c.req.query("since"),
    after_id: c.req.query("after_id"),
    gym_id: c.req.query("gym_id") ?? ""
  };

  const parsed = ChangesQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid query params", details: parsed.error.format() },
      400
    );
  }

  const scope = deviceScope(c);
  if (parsed.data.gym_id !== scope.gymId) {
    return c.json(
      { error: "Forbidden - device synchronization scope mismatch" },
      403,
    );
  }

  try {
    const result = await syncService.getChanges(parsed.data);
    // La bajada es la única señal que deja **siempre** una sede viva: la subida
    // ni sale a la red cuando el outbox está vacío. Sin anotarla aquí, una sede
    // tranquila pero conectada aparecería `SIN_NOTICIAS` en el semáforo de
    // cierre (M5, docs/MULTI_SEDE.md §6.2) y se le buscaría una avería de red
    // que no tiene.
    await registrarNoticiaDeLaSede(prisma, {
      deviceId: scope.deviceId,
      cuando: trustedClock.nowUtc(),
      motivo: "BAJADA",
      alFallar: (err) => logger.error("No se pudo anotar la noticia de la sede", { err }),
    });
    return c.json({ ok: true, ...result });
  } catch (err) {
    logger.error("Error in getChangesController", err);
    return c.json({ error: "Internal error in changes" }, 500);
  }
}
