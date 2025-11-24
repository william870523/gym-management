import { z } from "zod";

// --- Gym ---
export const GymSchema = z.object({
    gym_id: z.string().optional(),
    codigo: z.string().min(1, "Código es requerido"),
    nombre: z.string().min(1, "Nombre es requerido"),
    direccion: z.string().optional().nullable(),
    ciudad: z.string().optional().nullable(),
    provincia: z.string().optional().nullable(),
    pais: z.string().optional().nullable(),
    timezone: z.string().optional().nullable(),
    activo: z.boolean().optional(),
    created_at: z.date().optional(),
    updated_at: z.date().optional(),
    deleted_at: z.date().optional().nullable(),
});

export const CreateGymSchema = GymSchema.omit({ gym_id: true, created_at: true, updated_at: true, deleted_at: true });
export const UpdateGymSchema = GymSchema.partial();

// --- Device ---
export const DeviceSchema = z.object({
    device_id: z.string().optional(),
    gym_id: z.string().min(1, "Gym ID es requerido"),
    nombre: z.string().min(1, "Nombre es requerido"),
    tipo: z.string().optional(),
    descripcion: z.string().optional().nullable(),
    ultima_ip: z.string().optional().nullable(),
    last_seen_at: z.date().optional().nullable(),
    // activo: z.boolean().optional(), // Removed
    is_active: z.boolean().optional(),
    secret_key: z.string().min(1, "Secret Key es requerida").optional(), // Optional for update, required for create logic handled below
    created_at: z.date().optional(),
    updated_at: z.date().optional(),
    deleted_at: z.date().optional().nullable(),
});

export const CreateDeviceSchema = DeviceSchema.omit({ created_at: true, updated_at: true, deleted_at: true });
export const UpdateDeviceSchema = DeviceSchema.partial();
