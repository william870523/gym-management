// gym-remote-api/src/infrastructure/http/routes/sync.routes.ts
import { Hono } from "hono";
import { authMiddleware } from "../middlewares/authMiddleware";
import { uploadEventsController, getChangesController } from "../controllers/sync.controller";

export function syncRoutes() {
  const app = new Hono();

  // Middleware de autenticación ya aplicado en server.ts (authDevice)
  // app.use("*", authMiddleware);

  app.post("/upload-events", uploadEventsController);
  app.get("/changes", getChangesController);

  return app;
}
