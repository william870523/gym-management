import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";
import {
    CreateMonedaSchema, UpdateMonedaSchema,
    CreateNacionalidadSchema, UpdateNacionalidadSchema,
    CreateTipoPagoSchema, UpdateTipoPagoSchema,
    CreateTipoCambioSchema, UpdateTipoCambioSchema,
    CreateReferenciaSchema, UpdateReferenciaSchema,
    CreateHorarioSchema, UpdateHorarioSchema,
    CreatePlanesPagoSchema, UpdatePlanesPagoSchema,
    CreateCuentaSchema, UpdateCuentaSchema
} from "../../../application/validation/catalogs.schemas";

// Helper for standard CRUD responses
const handleCrud = async (c: Context, model: any, schema: any, updateSchema: any, idField: string) => {
    // This helper is a bit complex to type strictly with Prisma dynamic models without more boilerplate,
    // so we will implement specific controllers for clarity and type safety.
    return c.json({ error: "Not implemented generic" }, 501);
};

// --- Moneda ---
export const getMonedas = async (c: Context) => {
    const items = await prisma.moneda.findMany({ where: { is_deleted: false } });
    return c.json(items);
};

export const getMonedaById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.moneda.findUnique({ where: { moneda_id: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createMoneda = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateMonedaSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.moneda.create({
        data: { ...parsed.data, moneda_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateMoneda = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateMonedaSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.moneda.update({
            where: { moneda_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteMoneda = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.moneda.update({
            where: { moneda_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- Nacionalidad ---
export const getNacionalidades = async (c: Context) => {
    const items = await prisma.nacionalidad.findMany({ where: { is_deleted: false } });
    return c.json(items);
};

export const getNacionalidadById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.nacionalidad.findUnique({ where: { nacionalidad_id: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createNacionalidad = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateNacionalidadSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.nacionalidad.create({
        data: { ...parsed.data, nacionalidad_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateNacionalidad = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateNacionalidadSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.nacionalidad.update({
            where: { nacionalidad_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteNacionalidad = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.nacionalidad.update({
            where: { nacionalidad_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- TipoPago ---
export const getTiposPago = async (c: Context) => {
    const items = await prisma.tipoPago.findMany({ where: { is_deleted: false } });
    return c.json(items);
};

export const getTipoPagoById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.tipoPago.findUnique({ where: { tipo_pago_id: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createTipoPago = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateTipoPagoSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.tipoPago.create({
        data: { ...parsed.data, tipo_pago_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateTipoPago = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateTipoPagoSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.tipoPago.update({
            where: { tipo_pago_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteTipoPago = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.tipoPago.update({
            where: { tipo_pago_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- TipoCambio ---
export const getTiposCambio = async (c: Context) => {
    const items = await prisma.tipoCambio.findMany({ where: { is_deleted: false } });
    return c.json(items);
};

export const getTipoCambioById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.tipoCambio.findUnique({ where: { tipo_cambio_id: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createTipoCambio = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateTipoCambioSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.tipoCambio.create({
        data: { ...parsed.data, tipo_cambio_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateTipoCambio = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateTipoCambioSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.tipoCambio.update({
            where: { tipo_cambio_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteTipoCambio = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.tipoCambio.update({
            where: { tipo_cambio_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- Referencia ---
export const getReferencias = async (c: Context) => {
    const items = await prisma.referencia.findMany({ where: { is_deleted: false } });
    return c.json(items);
};

export const getReferenciaById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.referencia.findUnique({ where: { referencia_id: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createReferencia = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateReferenciaSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.referencia.create({
        data: { ...parsed.data, referencia_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateReferencia = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateReferenciaSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.referencia.update({
            where: { referencia_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteReferencia = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.referencia.update({
            where: { referencia_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- Horario ---
export const getHorarios = async (c: Context) => {
    const items = await prisma.horario.findMany({ where: { is_deleted: false } });
    return c.json(items);
};

export const getHorarioById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.horario.findUnique({ where: { horario_id: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createHorario = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateHorarioSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.horario.create({
        data: { ...parsed.data, horario_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateHorario = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateHorarioSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.horario.update({
            where: { horario_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteHorario = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.horario.update({
            where: { horario_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- PlanesPago ---
export const getPlanesPago = async (c: Context) => {
    const items = await prisma.planesPago.findMany({ where: { is_deleted: false } });
    return c.json(items);
};

export const getPlanPagoById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.planesPago.findUnique({ where: { id_planes_pago: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createPlanPago = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreatePlanesPagoSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.planesPago.create({
        data: { ...parsed.data, id_planes_pago: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updatePlanPago = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdatePlanesPagoSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.planesPago.update({
            where: { id_planes_pago: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deletePlanPago = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.planesPago.update({
            where: { id_planes_pago: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};

// --- Cuenta ---
export const getCuentas = async (c: Context) => {
    const items = await prisma.cuenta.findMany({ where: { is_deleted: false } });
    return c.json(items);
};

export const getCuentaById = async (c: Context) => {
    const id = c.req.param("id");
    const item = await prisma.cuenta.findUnique({ where: { cuenta_id: id } });
    if (!item || item.is_deleted) return c.json({ error: "Not found" }, 404);
    return c.json(item);
};

export const createCuenta = async (c: Context) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CreateCuentaSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    const newItem = await prisma.cuenta.create({
        data: { ...parsed.data, cuenta_id: crypto.randomUUID() }
    });
    return c.json(newItem, 201);
};

export const updateCuenta = async (c: Context) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateCuentaSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "Invalid data", details: parsed.error.format() }, 400);

    try {
        const updated = await prisma.cuenta.update({
            where: { cuenta_id: id },
            data: parsed.data
        });
        return c.json(updated);
    } catch (e) {
        return c.json({ error: "Update failed or not found" }, 404);
    }
};

export const deleteCuenta = async (c: Context) => {
    const id = c.req.param("id");
    try {
        await prisma.cuenta.update({
            where: { cuenta_id: id },
            data: { is_deleted: true, deleted_at: new Date() }
        });
        return c.json({ ok: true });
    } catch (e) {
        return c.json({ error: "Delete failed or not found" }, 404);
    }
};
