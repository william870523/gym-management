import type { Context } from "hono";
import { prisma } from "../../db/prismaClient";
import {
    CreateMonedaSchema, UpdateMonedaSchema,
    CreateNacionalidadSchema, UpdateNacionalidadSchema,
    CreateTipoPagoSchema, UpdateTipoPagoSchema,
    CreateTipoCambioSchema, UpdateTipoCambioSchema,
    CreateReferenciaSchema, UpdateReferenciaSchema,
} from "../../../application/validation/catalogs.schemas";
import { PlanesPagoController } from "./PlanesPagoController";
import { HorarioController } from "./HorarioController";
import { CuentaController } from "./CuentaController";

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
const horarioController = new HorarioController();
export const getHorarios = (c: Context) => horarioController.list(c);
export const getHorarioById = (c: Context) => horarioController.getById(c);
export const createHorario = (c: Context) => horarioController.create(c);
export const updateHorario = (c: Context) => horarioController.update(c);
export const deleteHorario = (c: Context) => horarioController.delete(c);

// --- PlanesPago ---
const planesPagoController = new PlanesPagoController();
export const getPlanesPago = (c: Context) => planesPagoController.list(c);
export const getPlanPagoById = (c: Context) => planesPagoController.getById(c);
export const createPlanPago = (c: Context) => planesPagoController.create(c);
export const updatePlanPago = (c: Context) => planesPagoController.update(c);
export const deletePlanPago = (c: Context) => planesPagoController.delete(c);

// --- Cuenta ---
const cuentaController = new CuentaController();
export const getCuentas = (c: Context) => cuentaController.list(c);
export const getCuentaById = (c: Context) => cuentaController.getById(c);
export const createCuenta = (c: Context) => cuentaController.create(c);
export const updateCuenta = (c: Context) => cuentaController.update(c);
export const deleteCuenta = (c: Context) => cuentaController.delete(c);
