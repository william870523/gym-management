import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";

const authenticatedGymId = (c: Context) => c.get("auth")?.gymId ?? null;

// --- PagoCliente ---
export const getPagosCliente = async (c: Context) => {
    const gymId = authenticatedGymId(c);
    if (!gymId) return c.json({ error: "El token no identifica un gimnasio." }, 403);
    // H6: paginación (antes devolvía la tabla entera) + H6-bis: NO filtrar
    // anulados, para que la lista coincida con la API local (los pagos
    // anulados deben poder verse también en web). Los totales se cuentan en
    // la base, no sobre la página cargada.
    const page = Number(c.req.query("page")) || 1;
    const limit = Number(c.req.query("limit")) || 10;
    const skip = (page - 1) * limit;
    const [items, total, totalVoided] = await Promise.all([
        prisma.pagoCliente.findMany({
            where: { gym_id: gymId },
            skip,
            take: limit,
            orderBy: { fecha: "desc" },
        }),
        prisma.pagoCliente.count({ where: { gym_id: gymId } }),
        prisma.pagoCliente.count({ where: { gym_id: gymId, is_deleted: true } }),
    ]);
    return c.json({ data: items, total, totalVoided });
};

export const getPagoClienteById = async (c: Context) => {
    const id = c.req.param("id");
    const gymId = authenticatedGymId(c);
    if (!gymId) return c.json({ error: "El token no identifica un gimnasio." }, 403);
    // H6-bis: sin filtro is_deleted, para poder abrir el recibo de un pago
    // anulado también en web (coherente con la API local y con escritorio).
    const item = await prisma.pagoCliente.findFirst({
        where: {
            pago_cliente_id: id,
            gym_id: gymId,
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
