import { z } from "zod";

export const LoginUserSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1, "Password is required")
});

export type LoginUserDTO = z.infer<typeof LoginUserSchema>;

export const LoginDeviceSchema = z.object({
    device_id: z.string().min(1, "Device ID is required"),
    secret: z.string().min(1, "Secret is required")
});

export type LoginDeviceDTO = z.infer<typeof LoginDeviceSchema>;

// Schema para registro de nuevo usuario
export const RegisterUserSchema = z.object({
    user_nombre: z.string().min(1, "Nombre es requerido"),
    user_email: z.string().email("Email inválido"),
    password: z.string().min(6, "Password debe tener al menos 6 caracteres"),
    role: z.enum(["admin", "user"]).default("user")
});

export type RegisterUserDTO = z.infer<typeof RegisterUserSchema>;
