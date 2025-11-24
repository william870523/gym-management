import { z } from "zod";

export const CreateCuentaSchema = z.object({
    nombre_cuenta: z.string().min(1, "El nombre es requerido"),
    moneda_id: z.string().uuid(),
    gym_id: z.string().optional().nullable(),
});

export type CreateCuentaDTO = z.infer<typeof CreateCuentaSchema>;

export const UpdateCuentaSchema = z.object({
    nombre_cuenta: z.string().min(1).optional(),
    moneda_id: z.string().uuid().optional(),
    gym_id: z.string().optional().nullable(),
});

export type UpdateCuentaDTO = z.infer<typeof UpdateCuentaSchema>;
