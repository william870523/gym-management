import type { Context } from "hono";
import { PrismaUserRepository } from "../../repositories/PrismaUserRepository";
import { PrismaDeviceRepository } from "../../repositories/PrismaDeviceRepository";
import { LoginUserUseCase } from "../../../application/use-cases/auth/LoginUserUseCase";
import { LoginDeviceUseCase } from "../../../application/use-cases/auth/LoginDeviceUseCase";
import { LoginUserSchema, LoginDeviceSchema } from "../../../application/dtos/AuthDTO";
import { JwtService } from "../../auth/jwt.service";
import { auditSecurityEvent } from "../../logging/audit-logger";
import { getClientIp } from "../middleware/rate-limit.middleware";
import { IpBlocker } from "../middleware/ip-block.middleware";
import { permissionsForRole } from "../../auth/permissions";

const extractRetryAfterSeconds = (message: string): number | null => {
    const match = message.match(/(\d+)\s+seconds?/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isNaN(parsed) ? null : parsed;
};

export class AuthController {
    private loginUserUseCase: LoginUserUseCase;
    private loginDeviceUseCase: LoginDeviceUseCase;

    constructor() {
        const userRepository = new PrismaUserRepository();
        const deviceRepository = new PrismaDeviceRepository();

        this.loginUserUseCase = new LoginUserUseCase(userRepository);
        this.loginDeviceUseCase = new LoginDeviceUseCase(deviceRepository);
    }


    /**
     * Registrar nuevo usuario
     * POST /auth/register
     */
    async registerUser(c: Context) {
        return c.json({
            error: "El registro público está deshabilitado.",
            error_code: "PUBLIC_REGISTRATION_DISABLED",
        }, 403);
    }

    /**
     * Login de usuario
     * POST /auth/login
     */
    async loginUser(c: Context) {
        const ip = getClientIp(c);
        try {
            // 1. Verificar bloqueo IP
            IpBlocker.checkBlock(c);

            const body = await c.req.json();
            const validated = LoginUserSchema.parse(body);
            const user = await this.loginUserUseCase.execute(validated);

            const token = JwtService.signAdminToken({
                userId: user.user_id,
                role: user.role,
                email: user.email,
                gymId: user.gym_id,
            });

            auditSecurityEvent({
                level: "INFO",
                category: "AUTH",
                action: "LOGIN_SUCCESS",
                ip,
                userId: user.user_id,
                success: true
            });

            // 2. Login exitoso -> Resetear intentos
            IpBlocker.resetAttempts(c);

            return c.json({
                ok: true,
                token,
                ...user,
                permissions: [...permissionsForRole(user.role)].sort(),
            });
        } catch (error: any) {
            // 3. Registrar intento fallido (si no fue bloqueo previo)
            if (!error.message.includes("Too many failed attempts")) {
                IpBlocker.recordFailedAttempt(c);
            }

            if (error.name === 'ZodError') {
                return c.json({ error: error.errors, error_code: "INVALID_PAYLOAD" }, 400);
            }

            auditSecurityEvent({
                level: "WARN",
                category: "AUTH",
                action: "LOGIN_FAILED",
                ip,
                success: false,
                metadata: { error: error.message }
            });

            if (error.message.includes("Too many failed attempts")) {
                return c.json({ error: error.message, error_code: "TOO_MANY_ATTEMPTS", retry_after_seconds: extractRetryAfterSeconds(error.message) }, 403);
            }

            if (error.message === "Invalid credentials") {
                return c.json({ error: "Invalid credentials", error_code: "INVALID_CREDENTIALS" }, 401);
            }
            if (error.message === "User account is inactive") {
                return c.json({ error: "User account is inactive", error_code: "USER_INACTIVE" }, 403);
            }
            return c.json({ error: "Internal Server Error", error_code: "INTERNAL_ERROR" }, 500);
        }
    }

    /**
     * Login de dispositivo
     * POST /auth/device-login
     */
    async loginDevice(c: Context) {
        const ip = getClientIp(c);
        try {
            // 1. Verificar bloqueo IP
            IpBlocker.checkBlock(c);

            const body = await c.req.json();
            const validated = LoginDeviceSchema.parse(body);
            const device = await this.loginDeviceUseCase.execute(validated);

            const token = JwtService.signDeviceToken({
                deviceId: device.device_id,
                gymId: device.gym_id,
                role: device.role
            });

            auditSecurityEvent({
                level: "INFO",
                category: "AUTH",
                action: "DEVICE_LOGIN_SUCCESS",
                ip,
                deviceId: device.device_id,
                gymId: device.gym_id,
                success: true
            });

            // 2. Login exitoso -> Resetear intentos
            IpBlocker.resetAttempts(c);

            return c.json({ ok: true, token, ...device });
        } catch (error: any) {
            // 3. Registrar intento fallido
            if (!error.message.includes("Too many failed attempts")) {
                IpBlocker.recordFailedAttempt(c);
            }

            if (error.name === 'ZodError') {
                return c.json({ error: error.errors, error_code: "INVALID_PAYLOAD" }, 400);
            }

            auditSecurityEvent({
                level: "WARN",
                category: "AUTH",
                action: "DEVICE_LOGIN_FAILED",
                ip,
                success: false,
                metadata: { error: error.message }
            });

            if (error.message.includes("Too many failed attempts")) {
                return c.json({ error: error.message, error_code: "TOO_MANY_ATTEMPTS", retry_after_seconds: extractRetryAfterSeconds(error.message) }, 403);
            }

            if (error.message === "Invalid credentials") {
                return c.json({ error: "Invalid credentials", error_code: "INVALID_CREDENTIALS" }, 401);
            }
            if (error.message === "Device is inactive") {
                return c.json({ error: "Device is inactive", error_code: "DEVICE_INACTIVE" }, 403);
            }
            return c.json({ error: "Internal Server Error", error_code: "INTERNAL_ERROR" }, 500);
        }
    }
}
