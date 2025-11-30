import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";
import {
    CreateClienteSchema, UpdateClienteSchema,
    CreateClientePesoSchema, UpdateClientePesoSchema,
    CreateAsistenciaSchema
} from "../../../application/validation/clients.schemas";

// --- Cliente ---
export const getClientes = async (c: Context) => {
    const gymId = c.get("gym_id"); // From auth middleware
    const items = await prisma.cliente.findMany({
        where: {
            is_deleted: false,
            gym_id: gymId
        }
    });
    return c.json(items);
};

export const getClienteByCi = async (c: Context) => {
    const ci = c.req.param("ci");
    const gymId = c.get("gym_id"); // From auth middleware
    const item = await prisma.cliente.findFirst({
        where: {
            ci,
            gym_id: gymId,
            is_deleted: false
        }
    });
    if (!item) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createCliente = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateClienteSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    // Check if exists
    const exists = await prisma.cliente.findUnique({ where: { ci: parsed.data.ci } });
    if (exists) return c.json({ error: "Cliente already exists" }, 409);

    const newItem = await prisma.cliente.create({
        data: { ...parsed.data }
    });
    return c.json(newItem, 201);
};

export const updateCliente = async (c: Context) => {
    const ci = c.req.param("ci");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateClienteSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.cliente.update({
            where: { ci },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteCliente = async (c: Context) => {
    const ci = c.req.param("ci");
    try {
        await prisma.cliente.update({
            where: { ci },
            data: { is_deleted: true, deleted_at: new Date(), activo: false }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- ClientePeso ---
export const getPesosByCliente = async (c: Context) => {
    const ci = c.req.param("ci");
    const items = await prisma.clientePeso.findMany({ where: { ci, is_deleted: false } });
    return c.json(items);
};

export const getPesoById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.clientePeso.findUnique({ where: { cliente_peso_id: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createClientePeso = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateClientePesoSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.clientePeso.create({
        data: { ...parsed.data, cliente_peso_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateClientePeso = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateClientePesoSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.clientePeso.update({
            where: { cliente_peso_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteClientePeso = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.clientePeso.update({
            where: { cliente_peso_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- Asistencia ---
export const getAsistenciasByCliente = async (c: Context) => {
    const ci = c.req.param("ci");
    const items = await prisma.asistencia.findMany({ where: { ci, is_deleted: false } });
    return c.json(items);
};

export const getAsistenciaById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.asistencia.findUnique({ where: { asistencia_id: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createAsistencia = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateAsistenciaSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.asistencia.create({
        data: { ...parsed.data, asistencia_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const deleteAsistencia = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.asistencia.update({
            where: { asistencia_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};
