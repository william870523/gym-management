import { z } from "zod";

export const CreateClienteSchema = z.object({
    ci: z.string().min(1),
    tipo_documento: z.enum(["CI_CUBANO", "PASAPORTE", "OTRO", "DESCONOCIDO"]).default("DESCONOCIDO"),
    // E0 (§7-bis): se admite «1985-04-20» y también ISO completo. El caso de uso
    // la resuelve de nuevo: con carné cubano la deriva del CI e ignora esto.
    fecha_nacimiento: z.string().min(1).or(z.date()).optional().nullable(),
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
    // R5.3 — categoría viejo/nuevo. **Decide el precio**, así que no puede
    // faltar aquí: sin esta línea zod la descartaba en silencio y el alta desde
    // la web guardaba el `@default("NUEVO")` del esquema aunque el operador
    // hubiera elegido VIEJO. Observado el 10-08-2026: pedido VIEJO, guardado
    // NUEVO, y la respuesta devolvía NUEVO sin avisar.
    categoria: z.enum(["NUEVO", "VIEJO"]).optional(),
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
    // E0 (§7-bis): acepta día suelto además de ISO completo. `datetime()` habría
    // rechazado «1985-04-20», que es justo lo que manda un selector de fecha.
    fecha_nacimiento: z.string().min(1).or(z.date()).optional().nullable(),
    referencia_id: z.string().min(1).optional().nullable(),
    // R5.3 — misma razón que en el alta: editar a VIEJO desde la web respondía
    // 200 y dejaba NUEVO.
    categoria: z.enum(["NUEVO", "VIEJO"]).optional(),
});

export type UpdateClienteDTO = z.infer<typeof UpdateClienteSchema>;
