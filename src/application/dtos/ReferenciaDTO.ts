import { z } from "zod";

export const CreateReferenciaSchema = z.object({
    nombre_referencia: z.string().min(1, "El nombre es requerido"),
});

export type CreateReferenciaDTO = z.infer<typeof CreateReferenciaSchema>;

export const UpdateReferenciaSchema = z.object({
    nombre_referencia: z.string().min(1).optional(),
});

export type UpdateReferenciaDTO = z.infer<typeof UpdateReferenciaSchema>;
