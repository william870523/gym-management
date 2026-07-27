import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { JwtService } from "../../auth/jwt.service";
import { auditSecurityEvent } from "../../logging/audit-logger";
import { getClientIp } from "./rate-limit.middleware";
import { prisma } from "../../db/prismaClient";
import { normalizeStaffRole, type StaffRole } from "../../../application/auth/staff-role";
import { resolveSedeContext } from "../../../application/auth/gym-context";

import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";

export interface UserGymActor {
    userId: string;
    gymId: string;
    role: string;
}

export type AdminSessionValidator = (input: {
    userId: string;
    gymId: string;
    requestedGymId?: string;
}) => Promise<boolean>;

/**
 * Resultado de resolver la sesión y su sede.
 *
 * `gymId` y `esPlataforma` son opcionales para que un doble de prueba pueda
 * devolver solo el puesto; en ese caso manda la sede del token.
 * `"not-found"` es la respuesta a pedir una sede donde esa persona no trabaja:
 * el middleware contesta 404 y no 403, para no delatar qué sedes existen.
 */
export type SessionResolution = {
    role: string;
    gymId?: string;
    esPlataforma?: boolean;
};

export type UserSessionValidator = (input: {
    userId: string;
    gymId: string;
    requestedGymId?: string;
}) => Promise<SessionResolution | "not-found" | null>;

/** Cabecera con la sede activa. El `gym_id` jamás se lee del cuerpo. */
export const GYM_CONTEXT_HEADER = "X-Gym-Id";

const requestedGymIdOf = (c: Context) =>
    c.req.header(GYM_CONTEXT_HEADER)?.trim() || undefined;

type SecurityAuditor = typeof auditSecurityEvent;

export const isAdminAuthPayload = (
    payload: Pick<AuthTokenPayload, "role"> | null | undefined,
) => payload?.role === "admin";

/**
 * Los puestos canónicos viven en `application/auth/staff-role.ts`, para que el
 * contexto de sede pueda usarlos sin depender de la capa HTTP. Se reexportan
 * aquí porque las rutas y sus pruebas los importan desde este módulo.
 */
export type { StaffRole };
export { normalizeStaffRole };

/** Métodos que solo leen: los ve cualquier miembro del personal. */
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const staffRoleOf = (c: Context): StaffRole | null =>
    normalizeStaffRole((c.get("auth") as AuthTokenPayload | undefined)?.role);

const denyRole = (
    c: Context,
    audit: SecurityAuditor,
    action: string,
    error: string,
    required: string,
) => {
    const auth = c.get("auth") as AuthTokenPayload | undefined;
    audit({
        level: "WARN",
        category: "AUTH",
        action,
        ip: getClientIp(c),
        userId: auth?.sub,
        gymId: auth?.gymId,
        success: false,
        metadata: { required, actualRole: auth?.role, method: c.req.method, path: c.req.path },
    });
    return c.json({ error }, 403);
};

/**
 * Exige una cuenta de personal reconocida (administración o recepción).
 * Va siempre DESPUÉS de `authUser`, que es quien revalida la sesión contra la
 * base y deja en el contexto el rol persistido, no el que traiga el token.
 */
export const requireStaff = (
    audit: SecurityAuditor = auditSecurityEvent,
) => createMiddleware(async (c, next) => {
    if (!esPlataforma(c) && !staffRoleOf(c)) {
        return denyRole(
            c,
            audit,
            "FORBIDDEN_STAFF_ROLE",
            "Forbidden - Staff role required",
            "admin | reception",
        );
    }
    await next();
});

const esPlataforma = (c: Context) =>
    (c.get("auth") as AuthTokenPayload | undefined)?.esPlataforma === true;

/**
 * Exige el nivel de **Dueño de la cadena**: crear o dar de baja una sede, y
 * cualquier cosa que afecte a más de un gimnasio. Está por encima de
 * administración, que manda solo dentro de su sede.
 */
export const requirePlatform = (
    audit: SecurityAuditor = auditSecurityEvent,
) => createMiddleware(async (c, next) => {
    if (!esPlataforma(c)) {
        const auth = c.get("auth") as AuthTokenPayload | undefined;
        audit({
            level: "WARN",
            category: "AUTH",
            action: "FORBIDDEN_PLATFORM_ACTION",
            ip: getClientIp(c),
            userId: auth?.sub,
            gymId: auth?.gymId,
            success: false,
            metadata: { required: "dueño de la cadena", method: c.req.method, path: c.req.path },
        });
        return c.json({
            error: "Esta acción es del dueño de la cadena",
            error_code: "PLATFORM_AUTHORITY_REQUIRED",
        }, 403);
    }
    await next();
});

/** Exige administración. Para lo que no debe hacer recepción: anular un cobro,
 *  borrar, firmar, configurar. El Dueño de la cadena la incluye. */
export const requireAdmin = (
    audit: SecurityAuditor = auditSecurityEvent,
) => createMiddleware(async (c, next) => {
    if (!esPlataforma(c) && staffRoleOf(c) !== "admin") {
        return denyRole(
            c,
            audit,
            "FORBIDDEN_ADMIN_ACTION",
            "Forbidden - Administration role required",
            "admin",
        );
    }
    await next();
});

/**
 * Catálogos y maestros: recepción los consulta para poder trabajar (planes,
 * cuentas, horarios, monedas…), pero solo administración los modifica.
 */
export const requireAdminForWrites = (
    audit: SecurityAuditor = auditSecurityEvent,
) => createMiddleware(async (c, next) => {
    const role = staffRoleOf(c);
    const dueno = esPlataforma(c);
    if (!role && !dueno) {
        return denyRole(
            c,
            audit,
            "FORBIDDEN_STAFF_ROLE",
            "Forbidden - Staff role required",
            "admin | reception",
        );
    }
    if (!READ_ONLY_METHODS.has(c.req.method) && !dueno && role !== "admin") {
        return denyRole(
            c,
            audit,
            "FORBIDDEN_ADMIN_WRITE",
            "Forbidden - Administration role required to modify this catalogue",
            "admin",
        );
    }
    await next();
});

export const getUserGymActor = (c: Context): UserGymActor | null => {
    const payload = c.get("auth") as AuthTokenPayload | undefined;
    const userId = payload?.sub?.trim();
    const gymId = payload?.gymId?.trim();
    const role = payload?.role;
    if (!userId || !gymId || !role || role === "device") return null;
    return { userId, gymId, role };
};

/**
 * Administración de una sede concreta. Con multi-sede, el ámbito se resuelve
 * con las mismas reglas que el resto (membresía o autoridad de Dueño) y encima
 * se exige que el puesto en ESA sede sea de administración.
 */
export const validateActiveAdminSession: AdminSessionValidator = async ({
    userId,
    gymId,
    requestedGymId,
}) => {
    const resolucion = await resolveSedeContext({
        userId,
        requestedGymId: requestedGymId ?? gymId,
    });
    if (!resolucion.ok) return false;
    return (
        resolucion.context.esPlataforma ||
        normalizeStaffRole(resolucion.context.role) === "admin"
    );
};

export const validateActiveUserSession: UserSessionValidator = async ({
    userId,
    gymId,
    requestedGymId,
}) => {
    const resolucion = await resolveSedeContext({
        userId,
        requestedGymId: requestedGymId ?? gymId,
    });
    if (!resolucion.ok) {
        return resolucion.reason === "not-found" ? "not-found" : null;
    }
    return {
        role: resolucion.context.role,
        gymId: resolucion.context.gymId,
        esPlataforma: resolucion.context.esPlataforma,
    };
};

declare module 'hono' {
    interface ContextVariableMap {
        auth: AuthTokenPayload;
        permissions: Set<string>;
    }
}


/**
 * Verifica un JWT de operador y revalida cuenta, sede y rol en cada request.
 * El rol persistido prevalece sobre un claim antiguo del token.
 */
export const authUser = (
    validateSession: UserSessionValidator = validateActiveUserSession,
    audit: SecurityAuditor = auditSecurityEvent,
) => createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized - Token required" }, 401);
    }

    let payload: AuthTokenPayload;
    try {
        payload = JwtService.verifyToken(authHeader.substring(7)) as AuthTokenPayload;
    } catch {
        return c.json({ error: "Unauthorized - Invalid token" }, 401);
    }

    const userId = payload.sub?.trim();
    const gymId = payload.gymId?.trim();
    const requestedGymId = requestedGymIdOf(c);
    // La sede puede venir de la cabecera aunque el token no traiga ninguna: es
    // el caso del Dueño de la cadena, que no pertenece a una sola sede.
    if (!userId || (!gymId && !requestedGymId) || payload.role === "device" || payload.deviceId) {
        return c.json({ error: "Forbidden - Active gym user required" }, 403);
    }

    let session: SessionResolution | "not-found" | null;
    try {
        session = await validateSession({ userId, gymId: gymId ?? "", requestedGymId });
    } catch {
        audit({
            level: "ERROR",
            category: "AUTH",
            action: "USER_REVALIDATION_FAILED",
            ip: getClientIp(c),
            userId,
            gymId,
            success: false,
        });
        return c.json({ error: "Authorization service unavailable" }, 503);
    }
    if (session === "not-found") {
        // Pedir una sede donde no se trabaja se responde como si no existiera:
        // un 403 permitiría descubrir qué sedes hay probando identificadores
        // (docs/MULTI_SEDE.md §3.3).
        audit({
            level: "WARN",
            category: "AUTH",
            action: "GYM_CONTEXT_DENIED",
            ip: getClientIp(c),
            userId,
            gymId: requestedGymId ?? gymId,
            success: false,
        });
        return c.json({ error: "Gym not found" }, 404);
    }
    if (!session) {
        audit({
            level: "WARN",
            category: "AUTH",
            action: "USER_SESSION_REVOKED",
            ip: getClientIp(c),
            userId,
            gymId,
            success: false,
        });
        return c.json({ error: "Forbidden - User account is inactive or out of scope" }, 403);
    }

    // La sede efectiva la decide el servidor, no el token ni el cuerpo.
    c.set("auth", {
        ...payload,
        sub: userId,
        gymId: session.gymId ?? gymId,
        role: session.role,
        esPlataforma: session.esPlataforma ?? false,
    });
    await next();
});

/**
 * Middleware que requiere un JWT de usuario con rol 'admin' (BACKWARD COMPATIBILITY + RBAC)
 */
export const authAdmin = (
    validateSession: AdminSessionValidator = validateActiveAdminSession,
    audit: SecurityAuditor = auditSecurityEvent,
) => createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Unauthorized - Token required" }, 401);
    }

    const token = authHeader.substring(7);
    let payload: AuthTokenPayload;
    try {
        payload = JwtService.verifyToken(token) as AuthTokenPayload;
    } catch (error) {
        audit({
            level: "WARN",
            category: "AUTH",
            action: "JWT_INVALID",
            ip: getClientIp(c),
            success: false,
            metadata: { error: "Invalid admin token" }
        });
        return c.json({ error: "Unauthorized - Invalid token" }, 401);
    }

    const userId = payload.sub?.trim();
    const gymId = payload.gymId?.trim();
    if (!isAdminAuthPayload(payload) || !userId || !gymId || payload.deviceId) {
        audit({
            level: "WARN",
            category: "AUTH",
            action: "FORBIDDEN_ADMIN_CLAIMS",
            ip: getClientIp(c),
            userId: payload.sub,
            gymId: payload.gymId,
            success: false,
            metadata: {
                required: "active admin user with gym",
                actualRole: payload.role,
            },
        });
        return c.json({ error: "Forbidden - Active gym admin required" }, 403);
    }

    // La sede activa también puede pedirse aquí; el validador comprueba que
    // esta administración tenga membresía en ella (o autoridad de Dueño).
    const requestedGymId = requestedGymIdOf(c);
    let activeSession = false;
    try {
        activeSession = await validateSession({ userId, gymId, requestedGymId });
    } catch (error) {
        audit({
            level: "ERROR",
            category: "AUTH",
            action: "ADMIN_REVALIDATION_FAILED",
            ip: getClientIp(c),
            userId,
            gymId,
            success: false,
        });
        return c.json({ error: "Authorization service unavailable" }, 503);
    }
    if (!activeSession) {
        audit({
            level: "WARN",
            category: "AUTH",
            action: "ADMIN_SESSION_REVOKED",
            ip: getClientIp(c),
            userId,
            gymId,
            success: false,
        });
        return c.json({ error: "Forbidden - Admin account is inactive or out of scope" }, 403);
    }

    c.set("auth", {
        ...payload,
        sub: userId,
        gymId: requestedGymId ?? gymId,
    });
    await next();
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
    let payload: AuthTokenPayload;
    try {
        payload = JwtService.verifyToken(token) as AuthTokenPayload;
    } catch (error) {
        return c.json({ error: "Unauthorized - Invalid token" }, 401);
    }
    if (payload.role !== "device") {
        return c.json({ error: "Forbidden - Device role required" }, 403);
    }
    c.set("auth", payload);
    await next();
});

export const requirePermission = (
    action: string,
    audit: SecurityAuditor = auditSecurityEvent,
) => createMiddleware(async (c) => {
    audit({
        level: "WARN",
        category: "AUTH",
        action: "PERMISSION_POLICY_UNAVAILABLE",
        ip: getClientIp(c),
        userId: c.get("auth")?.sub,
        gymId: c.get("auth")?.gymId,
        success: false,
        metadata: { requestedPermission: action },
    });
    return c.json({ error: "Forbidden - Permission policy is not configured" }, 403);
});
