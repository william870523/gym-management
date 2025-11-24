import { Hono } from "hono";
import { PlanesPagoController } from "../controllers/PlanesPagoController";

export const planesPagoRoutes = new Hono();
const controller = new PlanesPagoController();

planesPagoRoutes.get("/", (c) => controller.list(c));
planesPagoRoutes.get("/:id", (c) => controller.getById(c));
planesPagoRoutes.post("/", (c) => controller.create(c));
planesPagoRoutes.put("/:id", (c) => controller.update(c));
planesPagoRoutes.delete("/:id", (c) => controller.delete(c));
