// gym-remote-api/src/application/validation/sync.schemas.ts
import { z } from "zod";

export const SyncEventSchema = z.object({
  event_id: z.string().min(1),
  entidad: z.string().min(1),
  operacion: z.enum(["INSERT", "UPDATE", "DELETE"]),
  entidad_id: z.string().min(1),
  payload: z.record(z.string(), z.any()),
  occurred_at_utc: z.string().datetime().optional(),
});

export const UploadEventsSchema = z.object({
  device_id: z.string().min(1),
  gym_id: z.string().min(1),
  sent_at_utc: z.string().datetime().optional(),
  clock_offset_ms: z.number().int().optional(),
  gym_timezone: z.string().optional(),
  events: z.array(SyncEventSchema).min(1)
});

export const ChangesQuerySchema = z.object({
  since: z.string().datetime().optional(),
  after_id: z.coerce.number().int().nonnegative().optional(),
  gym_id: z.string().min(1)
}).refine(
  (value) => value.after_id !== undefined || value.since !== undefined,
  { message: "after_id or since is required" },
);

export type SyncEventDTO = z.infer<typeof SyncEventSchema>;
export type UploadEventsDTO = z.infer<typeof UploadEventsSchema>;
export type ChangesQueryDTO = z.infer<typeof ChangesQuerySchema>;
