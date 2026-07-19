import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";
import {
    CreatePagoClienteSchema, UpdatePagoClienteSchema,
    CreateDetallePagoSchema, UpdateDetallePagoSchema
} from "../../../application/validation/payments.schemas";

const authenticatedGymId = (c: Context) => c.get("auth")?.gymId ?? null;

// --- PagoCliente ---
export const getPagosCliente = async (c: Context) => {
    const gymId = authenticatedGymId(c);
    if (!gymId) return c.json({ error: "El token no identifica un gimnasio." }, 403);
    const items = await prisma.pagoCliente.findMany({
        where: {
            is_deleted: false,
            gym_id: gymId
        }
    });
    return c.json(items);
};

export const getPagoClienteById = async (c: Context) => {
    const id = c.req.param("id");
    const gymId = authenticatedGymId(c);
    if (!gymId) return c.json({ error: "El token no identifica un gimnasio." }, 403);
    const item = await prisma.pagoCliente.findFirst({
        where: {
            pago_cliente_id: id,
            gym_id: gymId,
            is_deleted: false
        }
    });
    if (!item) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createPagoCliente = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreatePagoClienteSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.pagoCliente.create({
        data: { ...parsed.data, pago_cliente_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updatePagoCliente = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdatePagoClienteSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.pagoCliente.update({
            where: { pago_cliente_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deletePagoCliente = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.pagoCliente.update({
            where: { pago_cliente_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- DetallePago ---
export const getDetallesPago = async (c: Context) => {
    const gymId = authenticatedGymId(c);
    if (!gymId) return c.json({ error: "El token no identifica un gimnasio." }, 403);
    const items = await prisma.detallePago.findMany({
        where: { is_deleted: false, gym_id: gymId },
    });
    return c.json(items);
};

export const getDetallePagoById = async (c: Context) => {
    const id = c.req.param("id");
    const gymId = authenticatedGymId(c);
    if (!gymId) return c.json({ error: "El token no identifica un gimnasio." }, 403);
    const item = await prisma.detallePago.findFirst({
        where: { detalle_pago_id: id, gym_id: gymId },
    });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createDetallePago = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateDetallePagoSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.detallePago.create({
        data: { ...parsed.data, detalle_pago_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateDetallePago = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateDetallePagoSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.detallePago.update({
            where: { detalle_pago_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteDetallePago = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.detallePago.update({
            where: { detalle_pago_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};
