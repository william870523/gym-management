import { Hono } from "hono";
import { ReferenciaController } from "../controllers/ReferenciaController";

export const referenciaRoutes = new Hono();
const controller = new ReferenciaController();

referenciaRoutes.get("/", (c) => controller.list(c));
referenciaRoutes.get("/:id", (c) => controller.getById(c));
referenciaRoutes.post("/", (c) => controller.create(c));
referenciaRoutes.put("/:id", (c) => controller.update(c));
referenciaRoutes.delete("/:id", (c) => controller.delete(c));
