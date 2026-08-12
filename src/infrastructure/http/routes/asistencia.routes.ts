import { Hono } from "hono";
import { AsistenciaController } from "../controllers/AsistenciaController";
import { requireAdmin } from "../middleware/auth.middleware";

export const asistenciaRoutes = new Hono();
const controller = new AsistenciaController();

// Marcar entradas y salidas es el mostrador. Corregir o borrar una asistencia
// ya registrada es administración: toca el historial de un socio.
asistenciaRoutes.get("/activos", (c) => controller.listActive(c));
asistenciaRoutes.get("/hoy", (c) => controller.listToday(c));
asistenciaRoutes.put("/:id/finalizar", (c) => controller.finalize(c));
asistenciaRoutes.put("/:id/pausar", (c) => controller.pause(c));
asistenciaRoutes.put("/:id/reanudar", (c) => controller.resume(c));
asistenciaRoutes.get("/", (c) => controller.list(c));
asistenciaRoutes.get("/:id", (c) => controller.getById(c));
asistenciaRoutes.post("/", (c) => controller.create(c));
asistenciaRoutes.put("/:id", requireAdmin(), (c) => controller.update(c));
asistenciaRoutes.delete("/:id", requireAdmin(), (c) => controller.delete(c));
