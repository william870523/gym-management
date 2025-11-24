import { createMiddleware } from "hono/factory";
import jwt from "jsonwebtoken";
import { env } from "../../../config/env";

/**
 * Middleware que verifica cualquier JWT válido (usuario o dispositivo)
 * Adjunta el payload decodificado al contexto como 'auth'
 */
export const authAny = () => createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized - Token required" }, 401);
    }

    const token = authHeader.substring(7); // Remove 'Bearer '
    try {
        const payload = jwt.verify(token, env.jwtSecret);
        c.set("auth", payload);
        await next();
    } catch (error) {
        return c.json({ error: "Unauthorized - Invalid token" }, 401);
    }
});

/**
 * Middleware que requiere un JWT de usuario con rol 'admin'
 */
export const authAdmin = () => createMiddleware(async (c, next) => {
    console.log(`[authAdmin DEBUG] Called for path: ${c.req.path}`);
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized - Token required" }, 401);
    }

    const token = authHeader.substring(7);
    try {
        const payload: any = jwt.verify(token, env.jwtSecret);
        if (payload.role !== "admin") {
            return c.json({ error: "Forbidden - Admin role required" }, 403);
        }
        c.set("auth", payload);
        await next();
    } catch (error) {
        return c.json({ error: "Unauthorized - Invalid token" }, 401);
    }
});

/**
 * Middleware que requiere un JWT de dispositivo con rol 'device'
 */
export const authDevice = () => createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized - Token required" }, 401);
    }

    const token = authHeader.substring(7);
    try {
        const payload: any = jwt.verify(token, env.jwtSecret);
        if (payload.role !== "device") {
            return c.json({ error: "Forbidden - Device role required" }, 403);
        }
        c.set("auth", payload);
        await next();
    } catch (error) {
        return c.json({ error: "Unauthorized - Invalid token" }, 401);
    }
});
