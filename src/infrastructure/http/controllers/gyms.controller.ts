import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";
import {
    CreateGymSchema, UpdateGymSchema,
    CreateDeviceSchema, UpdateDeviceSchema
} from "../../../application/validation/gyms.schemas";

// --- Gym ---
export const getGyms = async (c: Context) => {
    const items = await prisma.gym.findMany({ where: { deleted_at: null } });
    return c.json(items);
};

export const getGymById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.gym.findUnique({ where: { gym_id: id } });
    if (!item || item.deleted_at) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createGym = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateGymSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.gym.create({
        data: { ...parsed.data, gym_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateGym = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateGymSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.gym.update({
            where: { gym_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteGym = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.gym.update({
            where: { gym_id: id },
            data: { deleted_at: new Date(), activo: false }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- Device ---
export const getDevices = async (c: Context) => {
    const items = await prisma.device.findMany({ where: { deleted_at: null } });
    return c.json(items);
};

export const getDeviceById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.device.findUnique({ where: { device_id: id } });
    if (!item || item.deleted_at) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createDevice = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateDeviceSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    // Ensure secret_key is present for creation if not in schema (it is optional in schema but we want it here)
    // Actually, let's rely on the schema validation. If it's optional there, we should check it here or set a default.
    // But the user wants to provide it.

    const deviceData = {
        ...parsed.data,
        device_id: parsed.data.device_id || crypto.randomUUID(),
        secret_key: parsed.data.secret_key || "default_secret_generated_" + crypto.randomUUID()
    };

    const newItem = await prisma.device.create({
        data: deviceData
    });
    return c.json(newItem, 201);
};

export const updateDevice = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateDeviceSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.device.update({
            where: { device_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteDevice = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.device.update({
            where: { device_id: id },
            data: { deleted_at: new Date(), is_active: false }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};
