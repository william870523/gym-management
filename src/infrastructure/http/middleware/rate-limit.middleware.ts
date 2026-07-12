import { Context, MiddlewareHandler } from "hono";
import { auditSecurityEvent } from "../../logging/audit-logger";

interface RateLimitOptions {
    windowMs: number;
    max: number;
    keyGenerator: (c: Context) => string;
    name?: string;
}

interface RateLimitInfo {
    count: number;
    resetTime: number;
}

// Almacenamiento in-memory de buckets
const buckets = new Map<string, RateLimitInfo>();

/**
 * Obtiene la IP real del cliente
 * 1. Lee x-forwarded-for (toma la primera si hay varias)
 * 2. Intenta obtener remoteAddr desde Bun
 * 3. Devuelve "unknown" por defecto
 */
export const getClientIp = (c: Context): string => {
    // 1. X-Forwarded-For
    const xForwardedFor = c.req.header("x-forwarded-for");
    if (xForwardedFor) {
        return xForwardedFor.split(",")[0].trim();
    }

    // 2. Remote Address (Bun specific)
    // En Hono con Bun, a veces la IP está disponible en c.env si se pasa el server,
    // pero la forma más estándar en entornos proxy es X-Forwarded-For.
    // Intentamos acceder a propiedades comunes donde podría estar la IP.
    // Nota: En Bun puro, sería server.requestIP(req), pero aquí estamos dentro de Hono.

    // Si estamos en un entorno que expone la IP en c.env (depende de cómo se inicie Hono)
    // @ts-ignore
    if (c.env?.ip) {
        // @ts-ignore
        return c.env.ip;
    }

    return "unknown";
};

/**
 * Middleware genérico de Rate Limiting
 */
// Middleware genérico de Rate Limiting (DISABLED)
export const rateLimit = (options: RateLimitOptions): MiddlewareHandler => {
    return async (c, next) => {
        // Bypass all checks
        await next();
    };
};
