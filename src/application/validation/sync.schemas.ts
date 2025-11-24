// gym-remote-api/src/application/validation/sync.schemas.ts
import { z } from "zod";

export const SyncEventSchema = z.object({
  event_id: z.string().min(1),
  entidad: z.string().min(1),
  operacion: z.enum(["INSERT", "UPDATE", "DELETE"]),
  entidad_id: z.string().min(1),
  payload: z.record(z.string(), z.any())
});

export const UploadEventsSchema = z.object({
  device_id: z.string().min(1),
  gym_id: z.string().min(1),
  events: z.array(SyncEventSchema).min(1)
});

export const ChangesQuerySchema = z.object({
  since: z.string().datetime(), // ISO string
  gym_id: z.string().min(1)
});

export type SyncEventDTO = z.infer<typeof SyncEventSchema>;
export type UploadEventsDTO = z.infer<typeof UploadEventsSchema>;
export type ChangesQueryDTO = z.infer<typeof ChangesQuerySchema>;
