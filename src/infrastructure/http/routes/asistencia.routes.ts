import { Hono } from "hono";
import { AsistenciaController } from "../controllers/AsistenciaController";

export const asistenciaRoutes = new Hono();
const controller = new AsistenciaController();

asistenciaRoutes.get("/activos", (c) => controller.listActive(c));
asistenciaRoutes.get("/hoy", (c) => controller.listToday(c));
asistenciaRoutes.put("/:id/finalizar", (c) => controller.finalize(c));
asistenciaRoutes.get("/", (c) => controller.list(c));
asistenciaRoutes.get("/:id", (c) => controller.getById(c));
asistenciaRoutes.post("/", (c) => controller.create(c));
asistenciaRoutes.put("/:id", (c) => controller.update(c));
asistenciaRoutes.delete("/:id", (c) => controller.delete(c));
