import { z } from "zod";

export const CreateCuentaSchema = z.object({
    cuenta_id: z.string().optional(),
    nombre_cuenta: z.string().min(1),
    moneda_id: z.string().uuid(),
    tipo_pago_id: z.string().optional().nullable(),
    gym_id: z.string().optional().nullable(),
    source_device: z.string().optional().nullable(),
    version: z.number().optional()
});

export type CreateCuentaDTO = z.infer<typeof CreateCuentaSchema>;

export const UpdateCuentaSchema = z.object({
    nombre_cuenta: z.string().min(1).optional(),
    moneda_id: z.string().uuid().optional(),
    tipo_pago_id: z.string().optional().nullable(),
    version: z.number().optional(),
});

export type UpdateCuentaDTO = z.infer<typeof UpdateCuentaSchema>;
