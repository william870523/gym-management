// gym-remote-api/src/application/validation/auth.schemas.ts
import { z } from "zod";

export const RegisterSchema = z.object({
  nombre: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8)
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export type RegisterDTO = z.infer<typeof RegisterSchema>;
export type LoginDTO = z.infer<typeof LoginSchema>;
