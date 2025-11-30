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
export const rateLimit = (options: RateLimitOptions): MiddlewareHandler => {
    return async (c, next) => {
        const key = options.keyGenerator(c);
        const now = Date.now();

        // Limpiar buckets expirados (lazy cleanup al acceder)
        let record = buckets.get(key);

        // Si no existe o expiró, reiniciar
        if (!record || now > record.resetTime) {
            record = {
                count: 0,
                resetTime: now + options.windowMs
            };
            buckets.set(key, record);
        }

        // Verificar límite
        if (record.count >= options.max) {
            if (options.name) {
                console.log(`[RateLimit] Limit reached for ${options.name} - Key: ${key}`);
            }

            // Audit Log
            auditSecurityEvent({
                level: "WARN",
                category: "RATE_LIMIT",
                action: "RATE_LIMIT_HIT",
                ip: getClientIp(c),
                success: false,
                metadata: {
                    limit: options.max,
                    key,
                    name: options.name
                }
            });

            const retryAfter = Math.ceil((record.resetTime - now) / 1000);

            c.header("X-RateLimit-Limit", options.max.toString());
            c.header("X-RateLimit-Remaining", "0");
            c.header("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000).toString());
            c.header("Retry-After", retryAfter.toString());

            return c.text("Too Many Requests", 429);
        }

        // Incrementar y continuar
        record.count++;

        c.header("X-RateLimit-Limit", options.max.toString());
        c.header("X-RateLimit-Remaining", (options.max - record.count).toString());
        c.header("X-RateLimit-Reset", Math.ceil(record.resetTime / 1000).toString());

        await next();
    };
};
