import { z } from "zod";

export const CreateDetallePagoSchema = z.object({
    pago_cliente_id: z.string().uuid(),
    tipo_pago_id: z.string().uuid(),
    moneda_id: z.string().uuid(),
    cuenta_id: z.string().uuid().optional().nullable(),
    cantidad: z.number().nonnegative(),
    tipo_cambio_id: z.string().uuid().optional().nullable(),
    gym_id: z.string().optional().nullable(),
});

export type CreateDetallePagoDTO = z.infer<typeof CreateDetallePagoSchema>;

export const UpdateDetallePagoSchema = z.object({
    pago_cliente_id: z.string().uuid().optional(),
    tipo_pago_id: z.string().uuid().optional(),
    moneda_id: z.string().uuid().optional(),
    cuenta_id: z.string().uuid().optional().nullable(),
    cantidad: z.number().nonnegative().optional(),
    tipo_cambio_id: z.string().uuid().optional().nullable(),
    gym_id: z.string().optional().nullable(),
});

export type UpdateDetallePagoDTO = z.infer<typeof UpdateDetallePagoSchema>;
