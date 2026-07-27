import { z } from "zod";

const UserRoleSchema = z.enum(["admin", "user"]);

export const CreateUserSchema = z.object({
    user_nombre: z.string().min(1, "Nombre es requerido"),
    user_email: z.string().email("Email inválido"),
    password: z.string().min(6, "Password debe tener al menos 6 caracteres"),
    role: UserRoleSchema.optional().default("user"),
    active: z.boolean().optional().default(true),
});

export const UpdateUserSchema = z.object({
    user_nombre: z.string().min(1, "Nombre es requerido").optional(),
    user_email: z.string().email("Email inválido").optional(),
    password: z.string().min(6, "Password debe tener al menos 6 caracteres").optional(),
    role: UserRoleSchema.optional(),
    active: z.boolean().optional(),
});
