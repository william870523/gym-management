// gym-remote-api/src/infrastructure/http/controllers/sync.controller.ts
import type { Context } from "hono";
import { Prisma } from "@prisma/client";
import { UploadEventsSchema, ChangesQuerySchema } from "../../../application/validation/sync.schemas";
import { SyncService } from "../../sync/SyncService";
import { logger } from "../../../config/logger";

const syncService = new SyncService();

// Maneja la carga de eventos de sincronizacion desde los clientes locales.
export async function uploadEventsController(c: Context) {
  const body = await c.req.json().catch(() => null);
  const parsed = UploadEventsSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid payload", details: parsed.error.format() },
      400
    );
  }

  try {
    const result = await syncService.uploadEvents(parsed.data);
    return c.json({ ok: true, processed: result.processed });
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
      return c.json({ ok: true, processed: 0, warning: "duplicate event_id, ignored" }, 200);
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
    since: c.req.query("since") ?? "",
    gym_id: c.req.query("gym_id") ?? ""
  };

  const parsed = ChangesQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid query params", details: parsed.error.format() },
      400
    );
  }

  try {
    const events = await syncService.getChanges(parsed.data);
    return c.json({ ok: true, events });
  } catch (err) {
    logger.error("Error in getChangesController", err);
    return c.json({ error: "Internal error in changes" }, 500);
  }
}
