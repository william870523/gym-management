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
