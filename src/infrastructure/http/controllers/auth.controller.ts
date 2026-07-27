// gym-remote-api/src/infrastructure/http/controllers/auth.controller.ts
import type { Context } from "hono";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../db/prismaClient";
import { LoginSchema } from "../../../application/validation/auth.schemas";
import { env } from "../../../config/env";
import { JwtService } from "../../auth/jwt.service";

export async function registerController(c: Context) {
  return c.json({
    error: "El registro público está deshabilitado.",
    error_code: "PUBLIC_REGISTRATION_DISABLED",
  }, 403);
}

export async function loginController(c: Context) {
  const body = await c.req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid payload", details: parsed.error.format() },
      400
    );
  }

  const { email, password } = parsed.data;

  // Determine if input is email or username
  const isEmail = email.includes("@");

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { user_email: email },
        { user_nombre: email }
      ]
    }
  });

  // Strict check for null user, deleted, or INACTIVE
  if (!user || user.is_deleted) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Explicit active check with logging for debug if needed
  if (!user.active) {
    return c.json({ error: "User account is inactive" }, 403);
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const token = JwtService.signAdminToken({
    userId: user.user_id,
    role: user.role,
    gymId: user.gym_id,
  });


  return c.json({
    token,
    user: {
      id: user.user_id,
      nombre: user.user_nombre,
      role: user.role, // Legacy
      permissions: []
    }
  });
}
