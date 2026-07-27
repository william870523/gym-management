import { Hono } from "hono";
import { ClientePesoController } from "../controllers/ClientePesoController";
import { requireAdmin } from "../middleware/auth.middleware";

export const clientePesoRoutes = new Hono();
const controller = new ClientePesoController();

clientePesoRoutes.get("/", (c) => controller.list(c));
clientePesoRoutes.get("/:id", (c) => controller.getById(c));
clientePesoRoutes.post("/", (c) => controller.create(c));
clientePesoRoutes.put("/:id", (c) => controller.update(c));
// Tomar el peso es del mostrador; borrar una medición del historial, no.
clientePesoRoutes.delete("/:id", requireAdmin(), (c) => controller.delete(c));
