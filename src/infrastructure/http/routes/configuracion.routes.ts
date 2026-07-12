import { Hono } from "hono";
import { randomUUID } from "crypto";
import { prisma } from "../../db/prismaClient";

export const configuracionRoutes = new Hono();
const BASE_CURRENCY_KEY = "BASE_CURRENCY_ID";
const BASE_CURRENCY_CONFIG_ID = "config-base-currency-global";

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
