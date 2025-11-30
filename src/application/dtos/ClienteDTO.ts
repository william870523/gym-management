import { z } from "zod";

export const CreateClienteSchema = z.object({
    ci: z.string().min(1),
    nombres: z.string().min(1),
    apellidos: z.string().min(1),
    sexo: z.string(),
    foto_cliente: z.string().optional().nullable(), // Base64
    cliente_peso_id: z.string(),
    estatura_cliente: z.number(),
    direccion: z.string().optional().nullable(),
    telefono: z.number().int().optional().nullable(),
    nacionalidad_id: z.string().min(1),
    correo: z.string().email().optional().nullable(),
    objetivo: z.string().optional().nullable(),
    id_planes_pago: z.string().min(1),
    id_entrenador: z.string().min(1).optional().nullable(),
    fecha_inicio: z.string().datetime(),
    fecha_fin: z.string().datetime(),
    activo: z.boolean(),
    id_horarios: z.string().min(1),
    referencia_id: z.string().min(1).optional().nullable(),
    gym_id: z.string().optional().nullable(),
});

export type CreateClienteDTO = z.infer<typeof CreateClienteSchema>;

export const UpdateClienteSchema = z.object({
    nombres: z.string().min(1).optional(),
    apellidos: z.string().min(1).optional(),
    sexo: z.string().optional(),
    foto_cliente: z.string().optional().nullable(), // Base64
    cliente_peso_id: z.string().optional(),
    estatura_cliente: z.number().optional(),
    direccion: z.string().optional().nullable(),
    telefono: z.number().int().optional().nullable(),
    nacionalidad_id: z.string().min(1).optional(),
    correo: z.string().email().optional().nullable(),
    objetivo: z.string().optional().nullable(),
    id_planes_pago: z.string().min(1).optional(),
    id_entrenador: z.string().min(1).optional().nullable(),
    fecha_inicio: z.string().datetime().optional(),
    fecha_fin: z.string().datetime().optional(),
    activo: z.boolean().optional(),
    id_horarios: z.string().min(1).optional(),
    referencia_id: z.string().min(1).optional().nullable(),
    gym_id: z.string().optional().nullable(),
});

export type UpdateClienteDTO = z.infer<typeof UpdateClienteSchema>;
