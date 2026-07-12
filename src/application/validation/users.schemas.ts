import { z } from "zod";

// --- User ---
export const UserSchema = z.object({
    user_id: z.string().optional(),
    user_nombre: z.string().min(1, "Nombre es requerido"),
    user_email: z.string().email("Email inválido"),
    password: z.string().min(6, "Password debe tener al menos 6 caracteres").optional().nullable(), // Nullable for updates
    role: z.string().default("user"),
    active: z.boolean().default(true),
    is_deleted: z.boolean().optional(),
    created_at: z.date().optional(),
    gym_id: z.string().optional().nullable(),
    source_device: z.string().optional().nullable(),
    version: z.number().optional(),
    updated_at: z.date().optional(),
    deleted_at: z.date().optional().nullable(),
});

export const CreateUserSchema = UserSchema.omit({ user_id: true, is_deleted: true, created_at: true, updated_at: true, deleted_at: true, version: true });
export const UpdateUserSchema = UserSchema.partial();
