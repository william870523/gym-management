import { z } from "zod";
import { normalizarSexo, SEXOS_CANONICOS } from "../../domain/sexo-policy";

/**
 * Sexo normalizado por el servidor (docs/PLAN_ESTADISTICAS.md §7).
 *
 * Va en el esquema para que lo apliquen todas las rutas que validan, sin que
 * nadie tenga que acordarse. El valor que sale de aquí es ya el que se guarda.
 */
export const sexoSchema = z
    .string()
    .min(1, "Sexo es requerido")
    .transform((valor, ctx) => {
        const normalizado = normalizarSexo(valor);
        if (normalizado === null) {
            ctx.addIssue({
                code: "custom",
                message:
                    `El sexo «${valor}» no es válido. Valores admitidos: ` +
                    `${SEXOS_CANONICOS.join(", ")}.`,
            });
            return z.NEVER;
        }
        return normalizado;
    });


// --- Cliente ---
export const ClienteSchema = z.object({
    ci: z.string().min(1, "CI es requerido"),
    tipo_documento: z.enum(["CI_CUBANO", "PASAPORTE", "OTRO", "DESCONOCIDO"]).default("DESCONOCIDO"),
    // E0 (§7-bis): se admite en el cuerpo porque con pasaporte u otro documento
    // hay que capturarla, pero el caso de uso la RESUELVE de nuevo: con carné
    // cubano la deriva del CI e ignora este valor.
    fecha_nacimiento: z.string().or(z.date()).optional().nullable(),
    nombres: z.string().min(1, "Nombres son requeridos"),
    apellidos: z.string().min(1, "Apellidos son requeridos"),
    sexo: sexoSchema,
    // foto_cliente: z.any().optional(),
    cliente_peso_id: z.string().min(1, "Peso ID es requerido"), // This might be tricky if circular dependency, but usually client is created with initial weight
    estatura_cliente: z.number().min(0),
    direccion: z.string().optional().nullable(),
    telefono: z.number().int().optional().nullable(),
    nacionalidad_id: z.string().min(1, "Nacionalidad es requerida"),
    correo: z.string().email().optional().nullable(),
    objetivo: z.string().optional().nullable(),
    id_planes_pago: z.string().min(1, "Plan de pago es requerido").optional().nullable(),
    id_entrenador: z.string().optional().nullable(),
    fecha_inicio: z.string().or(z.date()).transform((val) => new Date(val)),
    fecha_fin: z.string().or(z.date()).transform((val) => new Date(val)),
    activo: z.boolean(),
    id_horarios: z.string().min(1, "Horario es requerido"),
    referencia_id: z.string().optional().nullable(),
    is_deleted: z.boolean().optional(),
    created_at: z.date().optional(),
    version: z.number().optional(),
    updated_at: z.date().optional(),
    deleted_at: z.date().optional().nullable(),
});

export const CreateClienteSchema = ClienteSchema.omit({ is_deleted: true, created_at: true, updated_at: true, deleted_at: true, version: true });
export const UpdateClienteSchema = ClienteSchema.partial();

// --- ClientePeso ---
export const ClientePesoSchema = z.object({
    cliente_peso_id: z.string().optional(),
    ci: z.string().min(1, "CI es requerido"),
    fecha: z.string().or(z.date()).transform((val) => new Date(val)),
    peso: z.number().min(0),
    is_deleted: z.boolean().optional(),
    created_at: z.date().optional(),
    version: z.number().optional(),
    updated_at: z.date().optional(),
    deleted_at: z.date().optional().nullable(),
});

export const CreateClientePesoSchema = ClientePesoSchema.omit({ cliente_peso_id: true, is_deleted: true, created_at: true, updated_at: true, deleted_at: true, version: true });
export const UpdateClientePesoSchema = ClientePesoSchema.partial();

// --- Asistencia ---
export const AsistenciaSchema = z.object({
    asistencia_id: z.string().optional(),
    ci: z.string().min(1, "CI es requerido"),
    is_deleted: z.boolean().optional(),
    created_at: z.date().optional(),
    version: z.number().optional(),
    updated_at: z.date().optional(),
    deleted_at: z.date().optional().nullable(),
});

export const CreateAsistenciaSchema = AsistenciaSchema.omit({ asistencia_id: true, is_deleted: true, created_at: true, updated_at: true, deleted_at: true, version: true });
