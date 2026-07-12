import { z } from "zod";

export const CreateTipoPagoSchema = z.object({
    nombre_tipo_pago: z.string().min(1, "El nombre es requerido"),
    codigo: z.string().min(1, "El código es requerido").optional(), // Optional for now to avoid breaking legacy calls
    activo: z.boolean().optional().default(true),
});

export type CreateTipoPagoDTO = z.infer<typeof CreateTipoPagoSchema>;

export const UpdateTipoPagoSchema = z.object({
    nombre_tipo_pago: z.string().min(1).optional(),
    codigo: z.string().min(1).optional(),
    activo: z.boolean().optional(),
});

export type UpdateTipoPagoDTO = z.infer<typeof UpdateTipoPagoSchema>;
