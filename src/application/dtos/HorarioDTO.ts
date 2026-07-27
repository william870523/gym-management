import { z } from "zod";

export const CreateHorarioSchema = z.object({
    nombre_horario: z.string().min(1, "El nombre es requerido"),
    hora_inicio: z.number().int().min(0).max(23),
    hora_fin: z.number().int().min(0).max(23),
});

export type CreateHorarioDTO = z.infer<typeof CreateHorarioSchema>;

export const UpdateHorarioSchema = z.object({
    nombre_horario: z.string().min(1).optional(),
    hora_inicio: z.number().int().min(0).max(23).optional(),
    hora_fin: z.number().int().min(0).max(23).optional(),
});

export type UpdateHorarioDTO = z.infer<typeof UpdateHorarioSchema>;
