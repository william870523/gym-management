import { Hono } from "hono";
import { PagoClienteController } from "../controllers/PagoClienteController";

export const pagoClienteRoutes = new Hono();
const controller = new PagoClienteController();

pagoClienteRoutes.get("/", (c) => controller.list(c));
pagoClienteRoutes.get("/cliente/:ci", (c) => controller.listByClient(c));
pagoClienteRoutes.get("/:id", (c) => controller.getById(c));
pagoClienteRoutes.post("/", (c) => controller.create(c));
pagoClienteRoutes.post("/process", (c) => controller.process(c));
pagoClienteRoutes.put("/:id", (c) => controller.update(c));
pagoClienteRoutes.delete("/:id", (c) => controller.delete(c));
