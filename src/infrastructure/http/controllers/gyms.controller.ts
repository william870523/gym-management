
import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";
import { v4 as uuidv4 } from 'uuid';
import { datePartsInZone, isValidTimeZone, nowUtc } from "../../../config/tz";
import {
    esMembresiaViva,
    fechaNegocioDesdePartes,
    resolveMembershipVigencia,
} from "../../../domain/membership-vigencia";
import { trustedClock } from "../../../config/trusted-clock";
import { getUserGymActor } from "../middleware/auth.middleware";
import { listSedesPermitidas } from "../../../application/auth/gym-context";
import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";

const CAMPOS_SEDE = {
    gym_id: true,
    nombre: true,
    codigo: true,
    direccion: true,
    ciudad: true,
    provincia: true,
    pais: true,
    codigo_postal: true,
    timezone: true,
    activo: true,
} as const;

const actorOrForbidden = (c: Context) => {
    const actor = getUserGymActor(c);
    if (!actor) {
        return { actor: null, response: c.json({ error: "Gym scope required" }, 403) };
    }
    return { actor, response: null };
};

const esDuenoDeCadena = (c: Context) =>
    (c.get("auth") as AuthTokenPayload | undefined)?.esPlataforma === true;

const soloDueno = (c: Context, accion: string) =>
    c.json({
        error: `${accion} es del dueño de la cadena`,
        error_code: "PLATFORM_AUTHORITY_REQUIRED",
    }, 403);

/**
 * Sedes que esta persona puede abrir: todas si es Dueño de la cadena, y solo
 * aquellas donde trabaja en el resto de los casos (docs/MULTI_SEDE.md §3).
 *
 * Antes devolvía **una sola** sede, la del token. Eso era correcto mientras un
 * usuario pertenecía a un único gimnasio; con multi-sede dejaría al Dueño sin
 * poder ver su propia cadena.
 */
export const getGyms = async (c: Context) => {
    const scoped = actorOrForbidden(c);
    if (!scoped.actor) return scoped.response;

    try {
        const permitidas = await listSedesPermitidas(scoped.actor.userId);
        if (!permitidas.length) return c.json([]);
        const gyms = await prisma.gym.findMany({
            where: { gym_id: { in: permitidas }, deleted_at: null },
            select: CAMPOS_SEDE,
            orderBy: { nombre: "asc" },
        });
        return c.json(gyms);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
};

/**
 * Alta de una sede. Solo el Dueño de la cadena, y **desde los dos destinos**:
 * escritorio y web (decisión del dueño, 26-07-2026).
 */
export const createGym = async (c: Context) => {
    const scoped = actorOrForbidden(c);
    if (!scoped.actor) return scoped.response;
    if (!esDuenoDeCadena(c)) return soloDueno(c, "Crear una sede");

    try {
        const body = await c.req.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return c.json({ error: "Invalid payload" }, 400);
        }
        const nombre = String(body.nombre ?? "").trim();
        const codigo = String(body.codigo ?? "").trim();
        if (!nombre || !codigo) {
            return c.json({ error: "Nombre y código son obligatorios" }, 400);
        }
        const timezone = String(body.timezone ?? "").trim() || "Etc/UTC";
        if (!isValidTimeZone(timezone)) {
            return c.json({ error: "Invalid IANA timezone" }, 400);
        }

        const duplicado = await prisma.gym.findFirst({
            where: { codigo },
            select: { gym_id: true },
        });
        if (duplicado) {
            return c.json({ error: "Ya existe una sede con ese código" }, 409);
        }

        const gym = await prisma.$transaction(async (tx) => {
            const creada = await tx.gym.create({
                data: {
                    gym_id: uuidv4(),
                    codigo,
                    nombre,
                    direccion: body.direccion ?? null,
                    ciudad: body.ciudad ?? null,
                    provincia: body.provincia ?? null,
                    pais: body.pais ?? null,
                    codigo_postal: body.codigo_postal ?? null,
                    timezone,
                    activo: body.activo ?? true,
                    created_at: trustedClock.nowUtc(),
                    updated_at: trustedClock.nowUtc(),
                },
            });
            // La sede es dato global: nace con `gym_id: null` en el registro de
            // sincronización, igual que la edición, para que llegue a todas las
            // instalaciones y no solo a la que la creó.
            await tx.syncLog.create({
                data: {
                    event_id: uuidv4(),
                    entidad: 'gym',
                    operacion: 'INSERT',
                    entidad_id: creada.gym_id,
                    gym_id: null,
                    payload_json: JSON.stringify(creada),
                },
            });
            return creada;
        });
        return c.json(gym, 201);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
};

/**
 * Socios que se quedarían incomunicados si se cierra esta sede
 * (docs/BAJA_DE_SEDE.md §2).
 *
 * Cerrar una sede la marca inactiva y nada más: sus socios siguen apuntando a
 * ella, y como el contexto de sede exige `gym.activo`, **ni el Dueño puede
 * volver a entrar a mirarlos**. Hasta que exista el expediente de baja con sus
 * decisiones por socio, la baja se rechaza si queda alguien dentro.
 *
 * «Dentro» se mide con la **vigencia derivada**, no con el estado guardado: una
 * sede cuyos socios vencieron hace medio año no tiene a nadie a quien dejar
 * tirado, y bloquearla sería un estorbo sin motivo.
 *
 * Gemela de la de `gym-local-api`.
 */
const sociosVivos = async (gymId: string) => {
    const [sede, membresias] = await Promise.all([
        prisma.gym.findUnique({ where: { gym_id: gymId }, select: { timezone: true } }),
        prisma.membresiaCliente.findMany({
            where: {
                gym_id: gymId,
                is_deleted: false,
                estado: { in: ["ACTIVA", "PENDIENTE_PAGO", "PAUSADA"] },
            },
            select: { ci: true, estado: true, fecha_fin: true },
        }),
    ]);
    const hoy = fechaNegocioDesdePartes(
        datePartsInZone(sede?.timezone?.trim() || "Etc/UTC", nowUtc()),
    );
    const socios = new Set<string>();
    for (const membresia of membresias) {
        const { vigencia } = resolveMembershipVigencia({
            estado: membresia.estado,
            fechaFin: membresia.fecha_fin,
            fechaNegocio: hoy,
        });
        if (esMembresiaViva(vigencia)) socios.add(membresia.ci);
    }
    return socios.size;
};

const puedeVerSede = async (c: Context, userId: string, gymId: string) => {
    if (esDuenoDeCadena(c)) return true;
    const permitidas = await listSedesPermitidas(userId);
    return permitidas.includes(gymId);
};

export const getGymById = async (c: Context) => {
    const id = c.req.param('id');
    const scoped = actorOrForbidden(c);
    if (!scoped.actor) return scoped.response;
    try {
        // Una sede donde esta persona no trabaja se responde como inexistente:
        // distinguirla con un 403 revelaría qué sedes tiene la cadena.
        if (!(await puedeVerSede(c, scoped.actor.userId, id))) {
            return c.json({ error: "Gym not found" }, 404);
        }
        const gym = await prisma.gym.findFirst({
            where: { gym_id: id, deleted_at: null },
        });
        if (!gym) return c.json({ error: "Gym not found" }, 404);
        return c.json(gym);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
};

export const updateGym = async (c: Context) => {
    const id = c.req.param('id');
    const scoped = actorOrForbidden(c);
    if (!scoped.actor) return scoped.response;
    try {
        if (!(await puedeVerSede(c, scoped.actor.userId, id))) {
            return c.json({ error: "Gym not found" }, 404);
        }
        const body = await c.req.json();
        if (body.timezone && !isValidTimeZone(body.timezone)) {
            return c.json({ error: "Invalid IANA timezone" }, 400);
        }
        const gym = await prisma.$transaction(async (tx) => {
            const existing = await tx.gym.findFirst({
                where: { gym_id: id, deleted_at: null },
                select: { gym_id: true },
            });
            if (!existing) throw Object.assign(new Error("Gym not found"), { code: "P2025" });
            const updatedGym = await tx.gym.update({
                where: { gym_id: id },
                data: {
                    nombre: body.nombre,
                    codigo: body.codigo,
                    direccion: body.direccion,
                    ciudad: body.ciudad,
                    provincia: body.provincia,
                    pais: body.pais,
                    codigo_postal: body.codigo_postal,
                    timezone: body.timezone,
                    updated_at: trustedClock.nowUtc(),
                }
            });

            await tx.syncLog.create({
                data: {
                    event_id: uuidv4(),
                    entidad: 'gym',
                    operacion: 'UPDATE',
                    entidad_id: updatedGym.gym_id,
                    gym_id: null,
                    payload_json: JSON.stringify(updatedGym)
                }
            });

            return updatedGym;
        });
        return c.json(gym);
    } catch (e: any) {
        if (e.code === 'P2025') {
            return c.json({ error: "Gym not found" }, 404);
        }
        return c.json({ error: e.message }, 500);
    }
};

/**
 * Baja de una sede. Solo el Dueño de la cadena, y **nunca la sede en la que se
 * está trabajando**: cerrar bajo los pies deja la sesión apuntando a un
 * gimnasio inactivo.
 */
export const deleteGym = async (c: Context) => {
    const id = c.req.param('id');
    const scoped = actorOrForbidden(c);
    if (!scoped.actor) return scoped.response;
    if (!esDuenoDeCadena(c)) return soloDueno(c, "Dar de baja una sede");
    if (id === scoped.actor.gymId) {
        return c.json({
            error: "No se puede dar de baja la sede en la que estás trabajando",
            error_code: "ACTIVE_GYM_CANNOT_BE_DELETED",
        }, 409);
    }

    const socios = await sociosVivos(id);
    if (socios > 0) {
        return c.json({
            error: `Esta sede todavía tiene ${socios} socio(s) con membresía viva. ` +
                "Resuelve a dónde van antes de cerrarla: al cerrarla dejarían de " +
                "ser alcanzables, incluso para el dueño de la cadena.",
            error_code: "SEDE_CON_SOCIOS_ACTIVOS",
            socios_activos: socios,
        }, 409);
    }

    try {
        const gym = await prisma.$transaction(async (tx) => {
            const existing = await tx.gym.findFirst({
                where: { gym_id: id, deleted_at: null },
                select: { gym_id: true },
            });
            if (!existing) throw Object.assign(new Error("Gym not found"), { code: "P2025" });
            const ahora = trustedClock.nowUtc();
            const borrada = await tx.gym.update({
                where: { gym_id: id },
                data: { activo: false, deleted_at: ahora, updated_at: ahora },
            });
            await tx.syncLog.create({
                data: {
                    event_id: uuidv4(),
                    entidad: 'gym',
                    operacion: 'DELETE',
                    entidad_id: borrada.gym_id,
                    gym_id: null,
                    payload_json: JSON.stringify(borrada),
                },
            });
            return borrada;
        });
        return c.json({ success: true, gym_id: gym.gym_id });
    } catch (e: any) {
        if (e.code === 'P2025') {
            return c.json({ error: "Gym not found" }, 404);
        }
        return c.json({ error: e.message }, 500);
    }
};

export const getDevices = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const getDeviceById = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const createDevice = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const updateDevice = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const deleteDevice = async (c: Context) => c.json({ error: "Not implemented" }, 501);
