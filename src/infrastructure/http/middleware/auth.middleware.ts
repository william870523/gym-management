import { createMiddleware } from "hono/factory";
import { JwtService } from "../../auth/jwt.service";
import { auditSecurityEvent } from "../../logging/audit-logger";
import { getClientIp } from "./rate-limit.middleware";

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
        const payload = JwtService.verifyToken(token);
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
        const payload = JwtService.verifyToken(token);
        if (payload.role !== "admin") {
            auditSecurityEvent({
                level: "WARN",
                category: "AUTH",
                action: "FORBIDDEN_ROLE",
                ip: getClientIp(c),
                userId: payload.sub,
                success: false,
                metadata: { required: "admin", actual: payload.role }
            });
            return c.json({ error: "Forbidden - Admin role required" }, 403);
        }
        c.set("auth", payload);
        await next();
    } catch (error) {
        auditSecurityEvent({
            level: "WARN",
            category: "AUTH",
            action: "JWT_INVALID",
            ip: getClientIp(c),
            success: false,
            metadata: { error: "Invalid admin token" }
        });
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
        const payload = JwtService.verifyToken(token);
        if (payload.role !== "device") {
            auditSecurityEvent({
                level: "WARN",
                category: "AUTH",
                action: "FORBIDDEN_ROLE",
                ip: getClientIp(c),
                deviceId: payload.sub,
                success: false,
                metadata: { required: "device", actual: payload.role }
            });
            return c.json({ error: "Forbidden - Device role required" }, 403);
        }
        c.set("auth", payload);
        await next();
    } catch (error) {
        auditSecurityEvent({
            level: "WARN",
            category: "AUTH",
            action: "JWT_INVALID",
            ip: getClientIp(c),
            success: false,
            metadata: { error: "Invalid device token" }
        });
        return c.json({ error: "Unauthorized - Invalid token" }, 401);
    }
});
