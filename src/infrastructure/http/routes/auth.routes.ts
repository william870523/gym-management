import { Hono } from "hono";
import { AuthController } from "../controllers/AuthController";
import { authUser } from "../middleware/auth.middleware";
import type { AuthTokenPayload } from "../../../domain/interfaces/AuthTokenPayload";

export const authRoutes = () => {
  const app = new Hono();
  const controller = new AuthController();

  // Fail closed: el bootstrap de administradores no se expone por HTTP.
  app.post("/register", (c) => controller.registerUser(c));

  // Login de usuario
  app.post("/login", (c) => controller.loginUser(c));

  // Login de dispositivo
  app.post("/device-login", (c) => controller.loginDevice(c));

  /**
   * Sesión resuelta: quién es, en qué sede está y si es **Dueño de la cadena**
   * (docs/MULTI_SEDE.md §3).
   *
   * El cliente no puede deducirlo de la respuesta del login, que se congela al
   * entrar: el nivel de Dueño llega y se revoca por sincronización. Aquí el
   * ámbito lo resuelve `authUser` contra la base, honrando `X-Gym-Id`, con las
   * mismas reglas que aplica el resto de los endpoints.
   */
  app.get("/session", authUser(), (c) => {
    const auth = c.get("auth") as AuthTokenPayload | undefined;
    return c.json({
      user_id: auth?.sub ?? null,
      role: auth?.role ?? null,
      gym_id: auth?.gymId ?? null,
      es_plataforma: auth?.esPlataforma === true,
      origen: "REMOTE_USER",
    });
  });

  return app;
};
