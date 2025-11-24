import { z } from "zod";

export const CreateNacionalidadSchema = z.object({
    nacionalidad_nombre: z.string().min(1, "El nombre es requerido"),
    codigo_iso: z.string().min(2, "El código ISO debe tener al menos 2 caracteres").max(3, "El código ISO no puede tener más de 3 caracteres"),
    bandera: z.string().optional().nullable(), // Base64 string
});

export type CreateNacionalidadDTO = z.infer<typeof CreateNacionalidadSchema>;

export const UpdateNacionalidadSchema = z.object({
    nacionalidad_nombre: z.string().min(1, "El nombre es requerido").optional(),
    codigo_iso: z.string().min(2).max(3).optional(),
    bandera: z.string().optional().nullable(), // Base64 string
});

export type UpdateNacionalidadDTO = z.infer<typeof UpdateNacionalidadSchema>;
