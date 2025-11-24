import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";
import {
    CreateEntrenadorSchema, UpdateEntrenadorSchema
} from "../../../application/validation/trainers.schemas";

// --- Entrenador ---
export const getEntrenadores = async (c: Context) => {
    const items = await prisma.entrenador.findMany({ where: { is_deleted: false } });
    return c.json(items);
};

export const getEntrenadorById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.entrenador.findUnique({ where: { id_entrenador: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createEntrenador = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateEntrenadorSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const exists = await prisma.entrenador.findUnique({ where: { ci_entrenador: parsed.data.ci_entrenador } });
    if (exists) return c.json({ error: "Entrenador already exists" }, 409);

    const newItem = await prisma.entrenador.create({
        data: { ...parsed.data, id_entrenador: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateEntrenador = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateEntrenadorSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.entrenador.update({
            where: { id_entrenador: id },
            data: parsed.data
        });
        return c.json(updated);
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
