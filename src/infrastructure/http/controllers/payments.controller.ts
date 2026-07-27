import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";

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
    return c.json({ error: "Legacy payment writes are disabled" }, 410);
};

export const updatePagoCliente = async (c: Context) => {
    return c.json({ error: "Legacy payment writes are disabled" }, 410);
};

export const deletePagoCliente = async (c: Context) => {
    return c.json({ error: "Legacy payment writes are disabled" }, 410);
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
    return c.json({ error: "Legacy payment detail writes are disabled" }, 410);
};

export const updateDetallePago = async (c: Context) => {
    return c.json({ error: "Legacy payment detail writes are disabled" }, 410);
};

export const deleteDetallePago = async (c: Context) => {
    return c.json({ error: "Legacy payment detail writes are disabled" }, 410);
};
