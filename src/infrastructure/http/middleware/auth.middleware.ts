import { createMiddleware } from "hono/factory";
import { JwtService } from "../../auth/jwt.service";
import { auditSecurityEvent } from "../../logging/audit-logger";
import { getClientIp } from "./rate-limit.middleware";
import { prisma } from "../../db/prismaClient";

import { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";

declare module 'hono' {
    interface ContextVariableMap {
        auth: AuthTokenPayload;
        permissions: Set<string>;
    }
}


/**
 * Middleware que verifica cualquier JWT válido y carga permisos
 */
export const authAny = () => createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized - Token required" }, 401);
    }

    const token = authHeader.substring(7);
    try {
        const payload = JwtService.verifyToken(token) as AuthTokenPayload;
        c.set("auth", payload);

        await next();
    } catch (error) {
        return c.json({ error: "Unauthorized - Invalid token" }, 401);
    }
});

/**
 * Middleware que requiere un JWT de usuario con rol 'admin' (BACKWARD COMPATIBILITY + RBAC)
 */
export const authAdmin = () => createMiddleware(async (c, next) => {
    // console.log(`[authAdmin DEBUG] Called for path: ${c.req.path}`);
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized - Token required" }, 401);
    }

    const token = authHeader.substring(7);
    try {
        const payload = JwtService.verifyToken(token) as AuthTokenPayload;

        c.set("auth", payload);

        // Check if user is admin via Token Claim
        const isLegacyAdmin = payload.role === "admin";

        if (!isLegacyAdmin) {
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
        const payload = JwtService.verifyToken(token) as AuthTokenPayload;
        if (payload.role !== "device") {
            // ... audit ...
            return c.json({ error: "Forbidden - Device role required" }, 403);
        }
        c.set("auth", payload);
        await next();
    } catch (error) {
        return c.json({ error: "Unauthorized - Invalid token" }, 401);
    }
});

// Guard Builder
// Guard Builder (DEPRECATED)
export const requirePermission = (action: string) => createMiddleware(async (c, next) => {
    return await next();
});
