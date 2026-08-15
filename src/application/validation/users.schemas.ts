import { z } from "zod";

// Debe coincidir con el catálogo canónico y con `usuario_sede.rol`.
// El esquema antiguo (admin/user) impedía editar desde la UI cualquier
// cuenta operativa real: reception, accounting o trainer terminaban en 400.
export const UserRoleSchema = z.enum([
  "admin",
  "reception",
  "accounting",
  "trainer",
]);

export const CreateUserSchema = z.object({
  user_nombre: z.string().min(1, "Nombre es requerido"),
  user_email: z.string().email("Email inválido"),
  password: z.string().min(6, "Password debe tener al menos 6 caracteres"),
  role: UserRoleSchema.optional().default("reception"),
  active: z.boolean().optional().default(true),
});

export const UpdateUserSchema = z.object({
  user_nombre: z.string().min(1, "Nombre es requerido").optional(),
  user_email: z.string().email("Email inválido").optional(),
  password: z
    .string()
    .min(6, "Password debe tener al menos 6 caracteres")
    .optional(),
  role: UserRoleSchema.optional(),
  active: z.boolean().optional(),
});
