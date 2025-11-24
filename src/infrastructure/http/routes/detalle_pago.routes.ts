import { Hono } from "hono";
import { DetallePagoController } from "../controllers/DetallePagoController";

export const detallePagoRoutes = new Hono();
const controller = new DetallePagoController();

detallePagoRoutes.get("/", (c) => controller.list(c));
detallePagoRoutes.get("/:id", (c) => controller.getById(c));
detallePagoRoutes.post("/", (c) => controller.create(c));
detallePagoRoutes.put("/:id", (c) => controller.update(c));
detallePagoRoutes.delete("/:id", (c) => controller.delete(c));
