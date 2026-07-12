
import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";
import { v4 as uuidv4 } from 'uuid';
import { env } from "../../../config/env";
import { isValidTimeZone } from "../../../config/tz";

export const getGyms = async (c: Context) => {
    // Optional: Check if admin
    /*
    const auth = c.get('auth');
    if (auth?.role !== 'admin') {
        // Maybe allow some visibility? But strictly speaking user asked for admin usage.
        return c.json({ error: "Forbidden" }, 403);
    }
    */

    try {
        const gyms = await prisma.gym.findMany({
            where: {
                deleted_at: null
            },
            select: {
                gym_id: true,
                nombre: true,
                codigo: true,
                direccion: true,
                ciudad: true,
                provincia: true,
                pais: true,
                codigo_postal: true,
                timezone: true,
                activo: true
            }
        });
        return c.json(gyms);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
};

export const createGym = async (c: Context) => {
    try {
        const body = await c.req.json();
        // Basic validation
        if (!body.nombre || !body.codigo) {
            return c.json({ error: "Missing required fields: nombre, codigo" }, 400);
        }
        const timezone = body.timezone ?? env.defaultGymTimezone;
        if (!isValidTimeZone(timezone)) {
            return c.json({ error: "Invalid IANA timezone" }, 400);
        }

        const gym = await prisma.$transaction(async (tx) => {
            const newGym = await tx.gym.create({
                data: {
                    gym_id: uuidv4(),
                    nombre: body.nombre,
                    codigo: body.codigo,
                    direccion: body.direccion,
                    ciudad: body.ciudad,
                    provincia: body.provincia,
                    pais: body.pais,
                    codigo_postal: body.codigo_postal,
                    timezone,
                    activo: body.activo !== undefined ? body.activo : true,
                }
            });

            // Create SyncLog for this new gym
            await tx.syncLog.create({
                data: {
                    event_id: uuidv4(),
                    entidad: 'gym',
                    operacion: 'INSERT',
                    entidad_id: newGym.gym_id,
                    gym_id: null, // Global entity, no specific gym ownership for distribution
                    payload_json: JSON.stringify(newGym)
                }
            });

            return newGym;
        });
        return c.json(gym, 201);
    } catch (e: any) {
        if (e.code === 'P2002') {
            return c.json({ error: "Gym code already exists" }, 409);
        }
        return c.json({ error: e.message }, 500);
    }
};

export const getGymById = async (c: Context) => {
    const id = c.req.param('id');
    try {
        const gym = await prisma.gym.findUnique({
            where: { gym_id: id }
        });
        if (!gym) return c.json({ error: "Gym not found" }, 404);
        return c.json(gym);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
};

export const updateGym = async (c: Context) => {
    const id = c.req.param('id');
    try {
        const body = await c.req.json();
        if (body.timezone && !isValidTimeZone(body.timezone)) {
            return c.json({ error: "Invalid IANA timezone" }, 400);
        }
        const gym = await prisma.$transaction(async (tx) => {
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
                    activo: body.activo,
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

export const deleteGym = async (c: Context) => {
    const id = c.req.param('id');
    try {
        // Soft delete
        const gym = await prisma.gym.update({
            where: { gym_id: id },
            data: {
                // is_deleted not in schema for Gym
                activo: false,
                deleted_at: new Date()
            }
        });
        return c.json({ message: "Gym deleted successfully" });
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
