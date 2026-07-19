import { Hono } from "hono";
import { randomUUID } from "crypto";
import { prisma } from "../../db/prismaClient";
import {
    RetentionSettingsError,
    RetentionSettingsService,
} from "../../../application/retention/retention-settings.service";

export const configuracionRoutes = new Hono();
const BASE_CURRENCY_KEY = "BASE_CURRENCY_ID";
const BASE_CURRENCY_CONFIG_ID = "config-base-currency-global";
const retentionSettings = new RetentionSettingsService();

const adminIdentity = (c: any) => {
    const auth = c.get("auth") as
        { sub?: string; role?: string; gymId?: string } | undefined;
    return auth?.sub && auth.gymId && auth.role === "admin" ? auth : null;
};

const settingsError = (c: any, error: unknown) => {
    if (error instanceof RetentionSettingsError) {
        return c.json({ error: error.message }, error.status);
    }
    throw error;
};

configuracionRoutes.get("/retention", async (c) => {
    const auth = adminIdentity(c);
    if (!auth?.gymId) {
        return c.json({ error: "Se requiere una cuenta administradora del gimnasio." }, 403);
    }
    return c.json(await retentionSettings.get(auth.gymId));
});

configuracionRoutes.put("/retention", async (c) => {
    const auth = adminIdentity(c);
    if (!auth?.gymId) {
        return c.json({ error: "Se requiere una cuenta administradora del gimnasio." }, 403);
    }
    try {
        const body = await c.req.json();
        return c.json(await retentionSettings.update(auth.gymId, {
            graceDays: body.grace_days,
            horizonDays: body.horizon_days,
        }));
    } catch (error) {
        return settingsError(c, error);
    }
});

configuracionRoutes.get("/base-currency", async (c) => {
    const config = await prisma.configuracionSistema.findUnique({
        where: { clave_gym_id: { clave: BASE_CURRENCY_KEY, gym_id: "GLOBAL" } },
    });
    const moneda = config
        ? await prisma.moneda.findUnique({ where: { moneda_id: config.valor } })
        : null;
    return c.json({ config, moneda });
});

configuracionRoutes.put("/base-currency", async (c) => {
    const body = await c.req.json();
    if (!body.moneda_id) {
        return c.json({ error: "moneda_id is required" }, 400);
    }

    const moneda = await prisma.moneda.findUnique({
        where: { moneda_id: body.moneda_id },
    });
    if (!moneda || moneda.is_deleted) {
        return c.json({ error: "Moneda not found" }, 404);
    }

    const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.configuracionSistema.findUnique({
            where: { clave_gym_id: { clave: BASE_CURRENCY_KEY, gym_id: "GLOBAL" } },
        });
        const config = await tx.configuracionSistema.upsert({
            where: { clave_gym_id: { clave: BASE_CURRENCY_KEY, gym_id: "GLOBAL" } },
            create: {
                configuracion_id: BASE_CURRENCY_CONFIG_ID,
                clave: BASE_CURRENCY_KEY,
                valor: body.moneda_id,
                descripcion: "Moneda base global para reportes y conversiones contables",
                gym_id: "GLOBAL",
                version: 1,
                updated_at: new Date(),
            },
            update: {
                valor: body.moneda_id,
                updated_at: new Date(),
                version: { increment: 1 },
                is_deleted: false,
                deleted_at: null,
            },
        });

        await tx.syncLog.create({
            data: {
                event_id: randomUUID(),
                entidad: "configuracion_sistema",
                operacion: existing ? "UPDATE" : "INSERT",
                entidad_id: config.configuracion_id,
                gym_id: null,
                device_id: "WEB_ADMIN",
                payload_json: JSON.stringify(config),
            },
        });

        return config;
    });

    return c.json(result);
});
