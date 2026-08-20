// gym-remote-api/src/infrastructure/http/routes/sync.routes.ts
import { Hono } from "hono";
import { authMiddleware } from "../middlewares/authMiddleware";
import { uploadEventsController, getChangesController } from "../controllers/sync.controller";
import { getVisitanteEnVivo } from "../controllers/visitante-vivo.controller";

export function syncRoutes() {
  const app = new Hono();

  // Middleware de autenticación ya aplicado en server.ts (authDevice)
  // app.use("*", authMiddleware);

  app.post("/upload-events", uploadEventsController);
  app.get("/changes", getChangesController);
  // §5.2 — el estado de ahora mismo de un visitante. Lo pregunta la instalación
  // justo antes de dejarlo entrar, para no admitir a quien cancelaron en su
  // sede mientras esta base no se había enterado todavía.
  app.get("/visitante/:ci", getVisitanteEnVivo);

  return app;
}
