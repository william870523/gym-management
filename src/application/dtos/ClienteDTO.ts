import { z } from "zod";

export const CreateClienteSchema = z.object({
    ci: z.string().min(1),
    tipo_documento: z.enum(["CI_CUBANO", "PASAPORTE", "OTRO", "DESCONOCIDO"]).default("DESCONOCIDO"),
    nombres: z.string().min(1),
    apellidos: z.string().min(1),
    sexo: z.string(),
    foto_cliente: z.any().optional().nullable(), // Base64 or Buffer
    cliente_peso_id: z.string().optional().nullable(),
    peso: z.any().optional(), // Allow numeric or string peso
    estatura_cliente: z.any(), // Allow string from multipart
    direccion: z.string().optional().nullable(),
    telefono: z.any().optional().nullable(),
    nacionalidad_id: z.string().min(1),
    correo: z.string().email().optional().nullable(),
    objetivo: z.string().optional().nullable(),
    id_planes_pago: z.string().min(1).optional().nullable(),
    id_entrenador: z.string().min(1).optional().nullable(),
    fecha_inicio: z.string().datetime(),
    fecha_fin: z.string().datetime(),
    activo: z.any(),
    id_horarios: z.string().min(1).optional().nullable(),
    referencia_id: z.string().min(1).optional().nullable(),
});

export type CreateClienteDTO = z.infer<typeof CreateClienteSchema>;

export const UpdateClienteSchema = z.object({
    tipo_documento: z.enum(["CI_CUBANO", "PASAPORTE", "OTRO", "DESCONOCIDO"]).optional(),
    nombres: z.string().min(1).optional(),
    apellidos: z.string().min(1).optional(),
    sexo: z.string().optional(),
    foto_cliente: z.any().optional().nullable(), // Base64 or Buffer
    cliente_peso_id: z.string().optional().nullable(),
    peso: z.any().optional(),
    estatura_cliente: z.any().optional(),
    direccion: z.string().optional().nullable(),
    telefono: z.any().optional().nullable(),
    nacionalidad_id: z.string().min(1).optional(),
    correo: z.string().email().optional().nullable(),
    objetivo: z.string().optional().nullable(),
    id_planes_pago: z.string().min(1).optional().nullable(),
    id_entrenador: z.string().min(1).optional().nullable(),
    fecha_inicio: z.string().datetime().optional(),
    fecha_fin: z.string().datetime().optional(),
    activo: z.any().optional(),
    id_horarios: z.string().min(1).optional().nullable(),
    fecha_nacimiento: z.string().datetime().optional().nullable(),
    referencia_id: z.string().min(1).optional().nullable(),
});

export type UpdateClienteDTO = z.infer<typeof UpdateClienteSchema>;
