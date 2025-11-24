import { z } from "zod";

export const CreateClientePesoSchema = z.object({
    ci: z.string().min(1),
    fecha: z.string().datetime(),
    peso: z.number().positive(),
    gym_id: z.string().optional().nullable(),
});

export type CreateClientePesoDTO = z.infer<typeof CreateClientePesoSchema>;

export const UpdateClientePesoSchema = z.object({
    ci: z.string().min(1).optional(),
    fecha: z.string().datetime().optional(),
    peso: z.number().positive().optional(),
    gym_id: z.string().optional().nullable(),
});

export type UpdateClientePesoDTO = z.infer<typeof UpdateClientePesoSchema>;
