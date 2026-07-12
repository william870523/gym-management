import { z } from "zod";

export const CreateAsistenciaSchema = z.object({
    asistencia_id: z.string().uuid().optional(),
    ci: z.string().min(1),
    fecha_salida: z.coerce.date().optional().nullable(),
    gym_id: z.string().optional().nullable(),
});

export type CreateAsistenciaDTO = z.infer<typeof CreateAsistenciaSchema>;

export const UpdateAsistenciaSchema = z.object({
    ci: z.string().min(1).optional(),
    fecha_salida: z.coerce.date().optional().nullable(),
    gym_id: z.string().optional().nullable(),
});

export type UpdateAsistenciaDTO = z.infer<typeof UpdateAsistenciaSchema>;
