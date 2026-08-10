import { z } from "zod";

export const CreateDetallePagoSchema = z.object({
    pago_cliente_id: z.string().uuid(),
    tipo_pago_id: z.string().uuid(),
    moneda_id: z.string().uuid(),
    cuenta_id: z.string().uuid().optional().nullable(),
    cantidad: z.number().nonnegative(),
    tipo_cambio_id: z.string().uuid().optional().nullable(),
    // R5.1: el cliente propone únicamente la base y la versión cotizada. El
    // servidor recalcula porcentaje, recargo y total dentro de la transacción.
    recargo_metodo_base: z.union([z.string(), z.number()]).optional().nullable(),
    recargo_metodo_tasa_version: z.number().int().positive().optional().nullable(),
});

export type CreateDetallePagoDTO = z.infer<typeof CreateDetallePagoSchema>;

export const UpdateDetallePagoSchema = z.object({
    pago_cliente_id: z.string().uuid().optional(),
    tipo_pago_id: z.string().uuid().optional(),
    moneda_id: z.string().uuid().optional(),
    cuenta_id: z.string().uuid().optional().nullable(),
    cantidad: z.number().nonnegative().optional(),
    tipo_cambio_id: z.string().uuid().optional().nullable(),
    recargo_metodo_base: z.union([z.string(), z.number()]).optional().nullable(),
    recargo_metodo_tasa_version: z.number().int().positive().optional().nullable(),
});

export type UpdateDetallePagoDTO = z.infer<typeof UpdateDetallePagoSchema>;
