import { Hono } from "hono";
import { TipoCambioController } from "../controllers/TipoCambioController";

export const tipoCambioRoutes = new Hono();
const controller = new TipoCambioController();

tipoCambioRoutes.get("/", (c) => controller.list(c));
tipoCambioRoutes.get("/:id", (c) => controller.getById(c));
tipoCambioRoutes.post("/", (c) => controller.create(c));
tipoCambioRoutes.put("/:id", (c) => controller.update(c));
tipoCambioRoutes.delete("/:id", (c) => controller.delete(c));
