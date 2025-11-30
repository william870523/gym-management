import { z } from "zod";

export const CreateAsistenciaSchema = z.object({
    asistencia_id: z.string().uuid().optional(),
    ci: z.string().min(1),
    gym_id: z.string().optional().nullable(),
});

export type CreateAsistenciaDTO = z.infer<typeof CreateAsistenciaSchema>;

export const UpdateAsistenciaSchema = z.object({
    ci: z.string().min(1).optional(),
    gym_id: z.string().optional().nullable(),
});

export type UpdateAsistenciaDTO = z.infer<typeof UpdateAsistenciaSchema>;
