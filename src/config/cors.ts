import { cors } from "hono/cors";
import { env } from "./env";
import { GYM_CONTEXT_HEADER } from "../infrastructure/http/middleware/auth.middleware";

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
        // OJO: esta lista se declara explícita, así que **una cabecera que no
        // esté aquí bloquea la petición entera en el navegador**, no la
        // cabecera sola. Y como cualquier cabecera propia dispara un preflight
        // `OPTIONS`, olvidarse de una deja la web sin poder llamar a NADA,
        // incluido `/health`. El escritorio no lo nota: fuera del navegador no
        // hay CORS.
        //
        // `X-Gym-Id` es la sede activa (docs/MULTI_SEDE.md §3.3). Se añadió al
        // cliente el 27-07-2026 y esta lista se quedó sin actualizar: la web
        // dejó de cargar en cuanto la sesión resolvía una sede.
        allowHeaders: [
            "Authorization",
            "Content-Type",
            "X-Requested-With",
            // AppClock calibra el reloj con una lectura no cacheable. En web
            // esta cabecera dispara preflight; si no se autoriza, el navegador
            // bloquea /system/time y la UI conserva el bootstrap Etc/UTC.
            "Cache-Control",
            GYM_CONTEXT_HEADER,
        ],
        exposeHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"],
        credentials: false, // Desactivado por defecto para mayor seguridad (stateless API)
        maxAge: 86400, // Cache preflight por 24 horas
    });
};
