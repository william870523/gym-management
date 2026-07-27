import { describe, expect, it } from "bun:test";
import { authRoutes } from "./auth.routes";
import { JwtService } from "../../auth/jwt.service";
import { isAdminAuthPayload } from "../middleware/auth.middleware";

describe("superficie pública de autenticación", () => {
  it("deshabilita /auth/register con una respuesta estable", async () => {
    const response = await authRoutes().request("/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user_nombre: "Atacante",
        user_email: "attacker@example.test",
        password: "password-seguro",
        role: "admin",
      }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "El registro público está deshabilitado.",
      error_code: "PUBLIC_REGISTRATION_DISABLED",
    });
  });

  it("no entrega la sesión resuelta sin token", async () => {
    // `GET /auth/session` dice en qué sede se está y si la cuenta es Dueño de
    // la cadena: sin sesión no hay nada que resolver (docs/MULTI_SEDE.md §3).
    const response = await authRoutes().request("/session");
    expect(response.status).toBe(401);
  });

  it("un token válido sin role admin no satisface la política de /users", () => {
    const token = JwtService.signAdminToken({
      userId: "user-1",
      role: "user",
      gymId: "gym-auth",
    });
    const payload = JwtService.verifyToken(token);
    expect(payload.role).toBe("user");
    expect(isAdminAuthPayload(payload as any)).toBe(false);
  });
});
