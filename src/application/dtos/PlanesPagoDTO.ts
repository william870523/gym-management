import { z } from "zod";

export const CreatePlanesPagoSchema = z.object({
    nombre_plan_pago: z.string().optional().nullable(),
    importe_plan_pago: z.number().nonnegative(),
    duracion_plan_pago: z.number().int().positive(),
    activo: z.boolean().optional().default(true),
    moneda_id: z.string().uuid(),
    gym_id: z.string().optional().nullable(),
});

export type CreatePlanesPagoDTO = z.infer<typeof CreatePlanesPagoSchema>;

export const UpdatePlanesPagoSchema = z.object({
    nombre_plan_pago: z.string().optional().nullable(),
    importe_plan_pago: z.number().nonnegative().optional(),
    duracion_plan_pago: z.number().int().positive().optional(),
    activo: z.boolean().optional(),
    moneda_id: z.string().uuid().optional(),
    gym_id: z.string().optional().nullable(),
});

export type UpdatePlanesPagoDTO = z.infer<typeof UpdatePlanesPagoSchema>;
