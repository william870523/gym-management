import type { Context } from "hono";
import bcrypt from "bcryptjs";
import { prisma } from "../../db/prismaClient";
import {
    CreateUserSchema, UpdateUserSchema
} from "../../../application/validation/users.schemas";

// --- User ---
export const getUsers = async (c: Context) => {
    // Exclude password from result
    const items = await prisma.user.findMany({
        where: { is_deleted: false },
        select: {
            user_id: true, user_nombre: true, user_email: true, role: true,
            createdAt: true, gym_id: true, is_deleted: true
        }
    });
    return c.json(items);
};

export const getUserById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.user.findUnique({
        where: { user_id: id },
        select: {
            user_id: true, user_nombre: true, user_email: true, role: true,
            createdAt: true, gym_id: true, is_deleted: true
        }
    });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createUser = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateUserSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const exists = await prisma.user.findUnique({ where: { user_email: parsed.data.user_email } });
    if (exists) return c.json({ error: "Email already in use" }, 409);

    const hashedPassword = await bcrypt.hash(parsed.data.password || "123456", 10);

    const newItem = await prisma.user.create({
        data: {
            ...parsed.data,
            password: hashedPassword,
            user_id: crypto.randomUUID(),
            createdAt: new Date()
        },
        select: {
            user_id: true, user_nombre: true, user_email: true, role: true,
            createdAt: true, gym_id: true
        }
    });
    return c.json(newItem, 201);
};

export const updateUser = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateUserSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const dataToUpdate = { ...parsed.data };
    if (dataToUpdate.password) {
        dataToUpdate.password = await bcrypt.hash(dataToUpdate.password, 10);
    }

    try {
        const updated = await prisma.user.update({
            where: { user_id: id },
            data: dataToUpdate,
            select: {
                user_id: true, user_nombre: true, user_email: true, role: true,
                createdAt: true, gym_id: true
            }
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteUser = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.user.update({
            where: { user_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};
