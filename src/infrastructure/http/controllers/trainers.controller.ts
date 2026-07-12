import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";
import {
    CreateEntrenadorSchema, UpdateEntrenadorSchema
} from "../../../application/validation/trainers.schemas";

const encodePhoto = (value: Buffer | null) =>
    value ? Buffer.from(value).toString("base64") : null;

const serializeEntrenador = (item: any) => ({
    ...item,
    foto_entrenador: encodePhoto(item.foto_entrenador ?? null),
});

const decodeBase64Photo = (value: unknown) => {
    if (typeof value === "string") {
        if (value.length === 0) return null;
        return Buffer.from(value, "base64");
    }
    if (value === null) return null;
    return undefined;
};

// --- Entrenador ---
export const getEntrenadores = async (c: Context) => {
    const items = await prisma.entrenador.findMany({ where: { is_deleted: false } });
    return c.json(items.map(serializeEntrenador));
};

export const getEntrenadorById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.entrenador.findUnique({ where: { id_entrenador: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(serializeEntrenador(item));
};

export const createEntrenador = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateEntrenadorSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const exists = await prisma.entrenador.findUnique({ where: { ci_entrenador: parsed.data.ci_entrenador } });
    if (exists) return c.json({ error: "Entrenador already exists" }, 409);

    const data: any = { ...parsed.data, id_entrenador: crypto.randomUUID() };
    const photoBuffer = decodeBase64Photo(parsed.data.foto_entrenador);
    if (photoBuffer !== undefined) data.foto_entrenador = photoBuffer;

    const newItem = await prisma.entrenador.create({ data });
    return c.json(serializeEntrenador(newItem), 201);
};

export const updateEntrenador = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateEntrenadorSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const data: any = { ...parsed.data };
        delete data.id_entrenador;
        const photoBuffer = decodeBase64Photo(parsed.data.foto_entrenador);
        if (photoBuffer !== undefined) data.foto_entrenador = photoBuffer;

        const updated = await prisma.entrenador.update({
            where: { id_entrenador: id },
            data
        });
        return c.json(serializeEntrenador(updated));
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteEntrenador = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.entrenador.update({
            where: { id_entrenador: id },
            data: { is_deleted: true, deleted_at: new Date(), activo_entrenador: false }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};
