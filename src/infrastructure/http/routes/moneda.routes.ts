import { Hono } from "hono";
import { MonedaController } from "../controllers/MonedaController";

export const monedaRoutes = new Hono();
const controller = new MonedaController();

monedaRoutes.get("/", (c) => controller.list(c));
monedaRoutes.get("/:id", (c) => controller.getById(c));
monedaRoutes.post("/", (c) => controller.create(c));
monedaRoutes.put("/:id", (c) => controller.update(c));
monedaRoutes.delete("/:id", (c) => controller.delete(c));
