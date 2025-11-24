import { Hono } from "hono";
import { TipoPagoController } from "../controllers/TipoPagoController";

export const tipoPagoRoutes = new Hono();
const controller = new TipoPagoController();

tipoPagoRoutes.get("/", (c) => controller.list(c));
tipoPagoRoutes.get("/:id", (c) => controller.getById(c));
tipoPagoRoutes.post("/", (c) => controller.create(c));
tipoPagoRoutes.put("/:id", (c) => controller.update(c));
tipoPagoRoutes.delete("/:id", (c) => controller.delete(c));
