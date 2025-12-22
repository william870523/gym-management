
import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";

export const getGyms = async (c: Context) => {
    // Optional: Check if admin
    const auth = c.get('auth');
    if (auth?.role !== 'admin') {
        // Maybe allow some visibility? But strictly speaking user asked for admin usage.
        return c.json({ error: "Forbidden" }, 403);
    }

    try {
        const gyms = await prisma.gym.findMany({
            where: {
                deleted_at: null,
                activo: true
            },
            select: {
                gym_id: true,
                nombre: true,
                codigo: true
            }
        });
        return c.json(gyms);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
};

export const createGym = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const getGymById = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const updateGym = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const deleteGym = async (c: Context) => c.json({ error: "Not implemented" }, 501);

export const getDevices = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const getDeviceById = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const createDevice = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const updateDevice = async (c: Context) => c.json({ error: "Not implemented" }, 501);
export const deleteDevice = async (c: Context) => c.json({ error: "Not implemented" }, 501);
