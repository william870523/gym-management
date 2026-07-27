import { z } from "zod";

/**
 * Recargo por mora (docs/RECARGO_MORA.md). El administrador elige por plan uno
 * de tres modos. Los importes viajan como string decimal; el servidor los
 * valida con `normalizeRecargoMoraConfig` antes de persistir.
 */
const recargoMoraFields = {
    recargo_mora_modo: z
        .enum(["PORCENTAJE", "MONTO_FIJO", "POR_DIA"])
        .optional()
        .nullable(),
    recargo_mora_valor: z.string().trim().min(1).optional().nullable(),
    recargo_mora_tope: z.string().trim().min(1).optional().nullable(),
    recargo_mora_activo: z.boolean().optional(),
};

export const CreatePlanesPagoSchema = z.object({
    nombre_plan_pago: z.string().optional().nullable(),
    importe_plan_pago: z.number().nonnegative(),
    duracion_plan_pago: z.number().int().positive(),
    activo: z.boolean().optional().default(true),
    moneda_id: z.string().uuid(),
    incluye_entrenador: z.boolean().optional().default(false),
    comision_entrenador_tipo: z.enum(["NONE", "PERCENTAGE", "FIXED_AMOUNT"]).optional().default("NONE"),
    comision_entrenador_valor: z.number().nonnegative().optional().nullable(),
    acepta_cuotas: z.boolean().optional().default(false),
    codigo: z.string().trim().min(1).optional().nullable(),
    precio_viejo_excepcion: z.number().nonnegative().optional().nullable(),
    ...recargoMoraFields,
});

export type CreatePlanesPagoDTO = z.infer<typeof CreatePlanesPagoSchema>;

export const UpdatePlanesPagoSchema = z.object({
    nombre_plan_pago: z.string().optional().nullable(),
    importe_plan_pago: z.number().nonnegative().optional(),
    duracion_plan_pago: z.number().int().positive().optional(),
    activo: z.boolean().optional(),
    moneda_id: z.string().uuid().optional(),
    incluye_entrenador: z.boolean().optional(),
    comision_entrenador_tipo: z.enum(["NONE", "PERCENTAGE", "FIXED_AMOUNT"]).optional(),
    comision_entrenador_valor: z.number().nonnegative().optional().nullable(),
    acepta_cuotas: z.boolean().optional(),
    codigo: z.string().trim().min(1).optional().nullable(),
    precio_viejo_excepcion: z.number().nonnegative().optional().nullable(),
    ...recargoMoraFields,
});

export type UpdatePlanesPagoDTO = z.infer<typeof UpdatePlanesPagoSchema>;
