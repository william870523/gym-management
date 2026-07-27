import { prisma } from "../../infrastructure/db/prismaClient";

/**
 * Contexto de sede de una petición (docs/MULTI_SEDE.md §3.3).
 *
 * Reglas que no se negocian:
 *
 * - El token **no** fija la sede de un usuario multi-sede. El cliente pide una
 *   sede con la cabecera `X-Gym-Id` y el servidor comprueba que esa persona
 *   tenga membresía activa allí.
 * - El `gym_id` **nunca** se lee del cuerpo de la petición.
 * - Sin cabecera se usa la sede por defecto del usuario (`User.gym_id`).
 * - Pedir una sede sin permiso responde **404**, no 403: si contestara 403,
 *   cualquiera podría averiguar qué sedes existen probando identificadores.
 * - El **Dueño de la cadena** (`es_plataforma`) entra a cualquier sede activa
 *   sin necesitar membresía; es el nivel por encima de administración.
 */
export interface SedeContext {
    gymId: string;
    /** Puesto EN ESA SEDE: el de la membresía, o el del usuario si es Dueño. */
    role: string;
    esPlataforma: boolean;
}

export type SedeResolution =
    | { ok: true; context: SedeContext }
    /** Cuenta inactiva, borrada o sin sede alguna. */
    | { ok: false; reason: "forbidden" }
    /** La sede no existe, no está activa, o esta persona no trabaja en ella. */
    | { ok: false; reason: "not-found" };

type Db = Pick<typeof prisma, "user" | "gym" | "usuarioSede">;

export async function resolveSedeContext(
    input: { userId: string; requestedGymId?: string | null },
    db: Db = prisma,
): Promise<SedeResolution> {
    const userId = input.userId.trim();
    if (!userId) return { ok: false, reason: "forbidden" };

    const user = await db.user.findFirst({
        where: { user_id: userId, active: true, is_deleted: false },
        select: { user_id: true, gym_id: true, role: true, es_plataforma: true },
    });
    if (!user) return { ok: false, reason: "forbidden" };

    const pedida = input.requestedGymId?.trim();
    const porDefecto = user.gym_id?.trim();
    const gymId = pedida && pedida.length > 0 ? pedida : porDefecto;

    // Un usuario sin sede pedida ni sede por defecto no tiene ámbito posible.
    // El Dueño tampoco: entrar «a todas» no es un ámbito, hay que elegir una.
    if (!gymId) return { ok: false, reason: "forbidden" };

    const gym = await db.gym.findFirst({
        where: { gym_id: gymId, activo: true, deleted_at: null },
        select: { gym_id: true },
    });
    if (!gym) return { ok: false, reason: "not-found" };

    if (user.es_plataforma) {
        return {
            ok: true,
            context: { gymId, role: user.role, esPlataforma: true },
        };
    }

    const membresia = await db.usuarioSede.findFirst({
        where: {
            user_id: userId,
            gym_id: gymId,
            activo: true,
            is_deleted: false,
        },
        select: { rol: true },
    });
    if (!membresia) return { ok: false, reason: "not-found" };

    return {
        ok: true,
        context: {
            // El puesto que manda es el de la membresía: la misma persona puede
            // ser recepción en una sede y administración en otra.
            role: membresia.rol,
            gymId,
            esPlataforma: false,
        },
    };
}

/**
 * Sedes donde esta persona puede trabajar. El Dueño de la cadena las ve todas;
 * el resto, solo aquellas donde tenga membresía activa.
 */
export async function listSedesPermitidas(
    userId: string,
    db: Db = prisma,
): Promise<string[]> {
    const user = await db.user.findFirst({
        where: { user_id: userId.trim(), active: true, is_deleted: false },
        select: { gym_id: true, es_plataforma: true },
    });
    if (!user) return [];

    if (user.es_plataforma) {
        const todas = await db.gym.findMany({
            where: { activo: true, deleted_at: null },
            select: { gym_id: true },
            orderBy: { gym_id: "asc" },
        });
        return todas.map((gym) => gym.gym_id);
    }

    const membresias = await db.usuarioSede.findMany({
        where: { user_id: userId.trim(), activo: true, is_deleted: false },
        select: { gym_id: true },
        orderBy: { gym_id: "asc" },
    });
    const ids = new Set(membresias.map((fila) => fila.gym_id));
    // La sede por defecto cuenta aunque su fila aún no exista: durante la
    // transición no se deja a nadie fuera (docs/MULTI_SEDE.md §7.4).
    if (user.gym_id) ids.add(user.gym_id);

    const activas = await db.gym.findMany({
        where: { gym_id: { in: [...ids] }, activo: true, deleted_at: null },
        select: { gym_id: true },
        orderBy: { gym_id: "asc" },
    });
    return activas.map((gym) => gym.gym_id);
}
