import { z } from "zod";

export const CreateTipoPagoSchema = z.object({
    nombre_tipo_pago: z.string().min(1, "El nombre es requerido"),
});

export type CreateTipoPagoDTO = z.infer<typeof CreateTipoPagoSchema>;

export const UpdateTipoPagoSchema = z.object({
    nombre_tipo_pago: z.string().min(1).optional(),
});

export type UpdateTipoPagoDTO = z.infer<typeof UpdateTipoPagoSchema>;
