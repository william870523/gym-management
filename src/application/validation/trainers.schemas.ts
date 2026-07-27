import { z } from "zod";

// --- Entrenador ---
export const EntrenadorSchema = z.object({
    id_entrenador: z.string().optional(),
    ci_entrenador: z.string().min(1, "CI es requerido"),
    tipo_documento: z.enum(["CI_CUBANO", "PASAPORTE", "OTRO", "DESCONOCIDO"]).default("DESCONOCIDO"),
    nombres_entrenador: z.string().min(1, "Nombres son requeridos"),
    apellidos_entrenador: z.string().min(1, "Apellidos son requeridos"),
    sexo_entrenador: z.string().min(1, "Sexo es requerido"),
    foto_entrenador: z.string().optional().nullable(),
    direccion_entrenador: z.string().optional().nullable(),
    telefono_entrenador: z.number().int().optional().nullable(),
    correo_entrenador: z.string().email().optional().nullable(),
    activo_entrenador: z.boolean(),
    fecha_incio_entrenador: z.string().or(z.date()).transform((val) => new Date(val)),
    is_deleted: z.boolean().optional(),
    created_at: z.date().optional(),
    version: z.number().optional(),
    updated_at: z.date().optional(),
    deleted_at: z.date().optional().nullable(),
});

export const CreateEntrenadorSchema = EntrenadorSchema.omit({ id_entrenador: true, is_deleted: true, created_at: true, updated_at: true, deleted_at: true, version: true });
export const UpdateEntrenadorSchema = EntrenadorSchema.partial();
