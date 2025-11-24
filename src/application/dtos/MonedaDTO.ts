import { z } from "zod";

export const CreateMonedaSchema = z.object({
    moneda_nombre: z.string().min(1, "El nombre es requerido"),
    codigo: z.string().min(1, "El código es requerido"),
    simbolo: z.string().optional().nullable(),
    imagen: z.string().optional().nullable(), // Base64 string
});

export type CreateMonedaDTO = z.infer<typeof CreateMonedaSchema>;

export const UpdateMonedaSchema = z.object({
    moneda_nombre: z.string().min(1).optional(),
    codigo: z.string().min(1).optional(),
    simbolo: z.string().optional().nullable(),
    imagen: z.string().optional().nullable(), // Base64 string
});

export type UpdateMonedaDTO = z.infer<typeof UpdateMonedaSchema>;
