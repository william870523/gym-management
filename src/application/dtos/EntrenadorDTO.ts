import { z } from "zod";

export const CreateEntrenadorSchema = z.object({
    ci_entrenador: z.string().min(1),
    tipo_documento: z.enum(["CI_CUBANO", "PASAPORTE", "OTRO", "DESCONOCIDO"]).default("DESCONOCIDO"),
    nombres_entrenador: z.string().min(1),
    apellidos_entrenador: z.string().min(1),
    sexo_entrenador: z.string(),
    foto_entrenador: z.any().optional().nullable(), // Base64 or Buffer
    direccion_entrenador: z.string().optional().nullable(),
    telefono_entrenador: z.any().optional().nullable(), // Allow string from multipart
    correo_entrenador: z.string().email().optional().nullable(),
    activo_entrenador: z.any(), // Allow string 'true'/'false'
    fecha_incio_entrenador: z.string().datetime(),
});

export type CreateEntrenadorDTO = z.infer<typeof CreateEntrenadorSchema>;

export const UpdateEntrenadorSchema = z.object({
    ci_entrenador: z.string().min(1).optional(),
    tipo_documento: z.enum(["CI_CUBANO", "PASAPORTE", "OTRO", "DESCONOCIDO"]).optional(),
    nombres_entrenador: z.string().min(1).optional(),
    apellidos_entrenador: z.string().min(1).optional(),
    sexo_entrenador: z.string().optional(),
    foto_entrenador: z.any().optional().nullable(), // Base64 or Buffer
    direccion_entrenador: z.string().optional().nullable(),
    telefono_entrenador: z.any().optional().nullable(),
    correo_entrenador: z.string().email().optional().nullable(),
    activo_entrenador: z.any().optional(),
    fecha_incio_entrenador: z.string().datetime().optional(),
});

export type UpdateEntrenadorDTO = z.infer<typeof UpdateEntrenadorSchema>;
