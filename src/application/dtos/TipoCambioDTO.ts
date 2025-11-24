import { z } from "zod";

export const CreateTipoCambioSchema = z.object({
    moneda_id_base: z.string().uuid("Debe ser un UUID válido"),
    moneda_id_target: z.string().uuid("Debe ser un UUID válido"),
    exchange_rate: z.number().positive("El tipo de cambio debe ser positivo"),
    fecha_inicio: z.string().datetime(),
    fecha_expiracion: z.string().datetime().optional().nullable(),
    activo: z.boolean().optional().default(true),
});

export type CreateTipoCambioDTO = z.infer<typeof CreateTipoCambioSchema>;

export const UpdateTipoCambioSchema = z.object({
    moneda_id_base: z.string().uuid().optional(),
    moneda_id_target: z.string().uuid().optional(),
    exchange_rate: z.number().positive().optional(),
    fecha_inicio: z.string().datetime().optional(),
    fecha_expiracion: z.string().datetime().optional().nullable(),
    activo: z.boolean().optional(),
});

export type UpdateTipoCambioDTO = z.infer<typeof UpdateTipoCambioSchema>;
