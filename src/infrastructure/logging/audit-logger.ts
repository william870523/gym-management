import { PrismaClient } from "@prisma/client";
import { logger } from "../../config/logger";

const prisma = new PrismaClient();

export type SecurityAuditLevel = "INFO" | "WARN" | "ERROR";
export type SecurityAuditCategory = "AUTH" | "RATE_LIMIT" | "ADMIN_ACTION" | "JWT";

export interface SecurityAuditEvent {
    level: SecurityAuditLevel;
    category: SecurityAuditCategory;
    action: string;
    ip?: string;
    userId?: string;
    deviceId?: string;
    gymId?: string;
    success: boolean;
    metadata?: Record<string, any>;
}

/**
 * Registra un evento de seguridad en la base de datos.
 * Es resiliente: si falla la BD, solo loguea en consola y no rompe el flujo.
 */
export const auditSecurityEvent = async (event: SecurityAuditEvent): Promise<void> => {
    try {
        // Log rápido a consola/archivo vía logger existente
        if (event.level === "ERROR") {
            logger.error(`[SECURITY] ${event.category}:${event.action} - ${JSON.stringify(event)}`);
        } else {
            logger.info(`[SECURITY] ${event.category}:${event.action} - Success: ${event.success}`);
        }

        // Persistencia asíncrona en BD
        await prisma.securityAuditLog.create({
            data: {
                level: event.level,
                category: event.category,
                action: event.action,
                ip: event.ip,
                userId: event.userId,
                deviceId: event.deviceId,
                gymId: event.gymId,
                success: event.success,
                metadata: event.metadata ? JSON.stringify(event.metadata) : null,
            },
        });
    } catch (error) {
        // Fallback seguro: no romper la request si falla el audit log
        console.error("[AuditLogger] Failed to persist security event:", error);
    }
};
