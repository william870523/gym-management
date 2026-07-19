import { Hono } from "hono";
import { ClienteController } from "../controllers/ClienteController";

export const clienteRoutes = new Hono();
const controller = new ClienteController();

clienteRoutes.get("/", (c) => controller.list(c));
clienteRoutes.get("/:id/expediente", (c) => controller.getRecord(c));
clienteRoutes.post("/:id/membresias/:membershipId/pausar", (c) => controller.pauseMembership(c));
clienteRoutes.post("/:id/membresias/:membershipId/reanudar", (c) => controller.resumeMembership(c));
clienteRoutes.get("/:id", (c) => controller.getById(c));
clienteRoutes.post("/", (c) => controller.create(c));
clienteRoutes.put("/:id", (c) => controller.update(c));
clienteRoutes.delete("/:id", (c) => controller.delete(c));
