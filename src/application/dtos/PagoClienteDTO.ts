import { z } from "zod";

export const CreatePagoClienteSchema = z.object({
    pago_cliente_id: z.string().uuid().optional(),
    ci: z.string().min(1),
    fecha: z.string().datetime(),
    monto_total: z.number().nonnegative(),
    id_entrenador: z.string().uuid().optional().nullable(),
    id_planes_pago: z.string().uuid(),
    moneda_id: z.string().uuid(),
    gym_id: z.string().optional().nullable(),
});

export type CreatePagoClienteDTO = z.infer<typeof CreatePagoClienteSchema>;

export const UpdatePagoClienteSchema = z.object({
    ci: z.string().min(1).optional(),
    fecha: z.string().datetime().optional(),
    monto_total: z.number().nonnegative().optional(),
    id_entrenador: z.string().uuid().optional().nullable(),
    id_planes_pago: z.string().uuid().optional(),
    moneda_id: z.string().uuid().optional(),
    gym_id: z.string().optional().nullable(),
});

export type UpdatePagoClienteDTO = z.infer<typeof UpdatePagoClienteSchema>;
