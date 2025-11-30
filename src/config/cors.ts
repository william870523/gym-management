import { cors } from "hono/cors";
import { env } from "./env";

/**
 * Middleware de CORS estricto
 * Permite configurar orígenes permitidos desde variables de entorno.
 */
export const corsMiddleware = () => {
    // Obtener orígenes permitidos desde ENV o usar default estricto
    // En producción, esto debería ser una lista específica de dominios
    const allowedOrigins = env.corsAllowedOrigins
        ? env.corsAllowedOrigins.split(",").map(o => o.trim())
        : ["*"]; // Fallback a * solo si no está configurado (dev), idealmente debería ser vacío o localhost

    return cors({
        origin: (origin) => {
            // Si se permite todo (*)
            if (allowedOrigins.includes("*")) return "*";

            // Si el origen está en la lista blanca
            if (origin && allowedOrigins.includes(origin)) {
                return origin;
            }

            // Bloquear por defecto si no coincide
            // Hono cors devuelve el origen si coincide, o null/undefined para bloquear
            return allowedOrigins[0]; // Retornar el primero como fallback seguro o null
        },
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
        exposeHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
        credentials: false, // Desactivado por defecto para mayor seguridad (stateless API)
        maxAge: 86400, // Cache preflight por 24 horas
    });
};
