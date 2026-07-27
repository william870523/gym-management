import { Hono } from "hono";
import { AuthController } from "../controllers/AuthController";

export const authRoutes = () => {
  const app = new Hono();
  const controller = new AuthController();

  // Fail closed: el bootstrap de administradores no se expone por HTTP.
  app.post("/register", (c) => controller.registerUser(c));

  // Login de usuario
  app.post("/login", (c) => controller.loginUser(c));

  // Login de dispositivo
  app.post("/device-login", (c) => controller.loginDevice(c));

  return app;
};
