import { Hono } from "hono";
import { EntrenadorController } from "../controllers/EntrenadorController";

export const entrenadorRoutes = new Hono();
const controller = new EntrenadorController();

entrenadorRoutes.get("/", (c) => controller.list(c));
entrenadorRoutes.get("/:id", (c) => controller.getById(c));
entrenadorRoutes.post("/", (c) => controller.create(c));
entrenadorRoutes.put("/:id", (c) => controller.update(c));
entrenadorRoutes.delete("/:id", (c) => controller.delete(c));
