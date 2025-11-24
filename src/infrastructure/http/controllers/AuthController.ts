import type { Context } from "hono";
import { PrismaUserRepository } from "../../repositories/PrismaUserRepository";
import { PrismaDeviceRepository } from "../../repositories/PrismaDeviceRepository";
import { LoginUserUseCase } from "../../../application/use-cases/auth/LoginUserUseCase";
import { LoginDeviceUseCase } from "../../../application/use-cases/auth/LoginDeviceUseCase";
import { RegisterUserUseCase } from "../../../application/use-cases/auth/RegisterUserUseCase";
import { LoginUserSchema, LoginDeviceSchema, RegisterUserSchema } from "../../../application/dtos/AuthDTO";

export class AuthController {
    private loginUserUseCase: LoginUserUseCase;
    private loginDeviceUseCase: LoginDeviceUseCase;
    private registerUserUseCase: RegisterUserUseCase;

    constructor() {
        const userRepository = new PrismaUserRepository();
        const deviceRepository = new PrismaDeviceRepository();
        this.loginUserUseCase = new LoginUserUseCase(userRepository);
        this.loginDeviceUseCase = new LoginDeviceUseCase(deviceRepository);
        this.registerUserUseCase = new RegisterUserUseCase(userRepository);
    }

    /**
     * Registrar nuevo usuario
     * POST /auth/register
     */
    async registerUser(c: Context) {
        try {
            const body = await c.req.json();
            const validated = RegisterUserSchema.parse(body);
            const result = await this.registerUserUseCase.execute(validated);
            return c.json({
                ok: true,
                message: "Usuario registrado exitosamente",
                ...result
            }, 201);
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: "Datos inválidos", details: error.errors }, 400);
            }
            if (error.message === "Email already registered") {
                return c.json({ error: "El email ya está registrado" }, 409);
            }
            console.error("Error en registro:", error);
            return c.json({ error: "Error interno del servidor" }, 500);
        }
    }

    /**
     * Login de usuario
     * POST /auth/login
     */
    async loginUser(c: Context) {
        try {
            const body = await c.req.json();
            const validated = LoginUserSchema.parse(body);
            const result = await this.loginUserUseCase.execute(validated);
            return c.json({ ok: true, ...result });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Invalid credentials") {
                return c.json({ error: "Invalid credentials" }, 401);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }

    /**
     * Login de dispositivo
     * POST /auth/device-login
     */
    async loginDevice(c: Context) {
        try {
            const body = await c.req.json();
            const validated = LoginDeviceSchema.parse(body);
            const result = await this.loginDeviceUseCase.execute(validated);
            return c.json({ ok: true, ...result });
        } catch (error: any) {
            if (error.name === 'ZodError') {
                return c.json({ error: error.errors }, 400);
            }
            if (error.message === "Invalid credentials") {
                return c.json({ error: "Invalid credentials" }, 401);
            }
            if (error.message === "Device is inactive") {
                return c.json({ error: "Device is inactive" }, 403);
            }
            return c.json({ error: "Internal Server Error" }, 500);
        }
    }
}
