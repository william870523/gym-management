import { Context } from "hono";
import { getClientIp } from "./rate-limit.middleware";
import { auditSecurityEvent } from "../../logging/audit-logger";

interface IpBlockInfo {
    failedAttempts: number;
    firstAttemptAt: number;
    blockedUntil: number;
}

const ipMap = new Map<string, IpBlockInfo>();

// Configuración (podría ir a env)
const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutos

export const IpBlocker = {
    /**
     * Verifica si una IP está bloqueada.
     * Lanza error si está bloqueada.
     */
    checkBlock: (c: Context) => {
        const ip = getClientIp(c);
        const info = ipMap.get(ip);

        if (!info) return;

        const now = Date.now();

        // Si está bloqueada
        if (info.blockedUntil > now) {
            const remainingSeconds = Math.ceil((info.blockedUntil - now) / 1000);

            // Audit log (opcional, para no inundar DB, solo loguear si no se ha logueado recientemente o sampling)
            // Aquí lo hacemos siempre para cumplir requisitos estrictos
            auditSecurityEvent({
                level: "WARN",
                category: "AUTH",
                action: "IP_BLOCKED_HIT",
                ip,
                success: false,
                metadata: { remainingSeconds }
            });

            throw new Error(`Too many failed attempts. Please try again in ${remainingSeconds} seconds.`);
        }

        // Si el bloqueo expiró, limpiar
        if (info.blockedUntil > 0 && info.blockedUntil <= now) {
            ipMap.delete(ip);
        }
    },

    /**
     * Registra un intento fallido
     */
    recordFailedAttempt: (c: Context) => {
        const ip = getClientIp(c);
        const now = Date.now();
        let info = ipMap.get(ip);

        if (!info) {
            info = { failedAttempts: 0, firstAttemptAt: now, blockedUntil: 0 };
            ipMap.set(ip, info);
        }

        // Resetear ventana si pasó el tiempo
        if (now - info.firstAttemptAt > WINDOW_MS) {
            info.failedAttempts = 0;
            info.firstAttemptAt = now;
        }

        info.failedAttempts++;

        if (info.failedAttempts >= MAX_FAILED_ATTEMPTS) {
            info.blockedUntil = now + BLOCK_DURATION_MS;

            auditSecurityEvent({
                level: "WARN",
                category: "AUTH",
                action: "IP_BLOCKED",
                ip,
                success: false,
                metadata: { durationMs: BLOCK_DURATION_MS }
            });
        }
    },

    /**
     * Resetea intentos tras login exitoso
     */
    resetAttempts: (c: Context) => {
        const ip = getClientIp(c);
        ipMap.delete(ip);
    }
};
