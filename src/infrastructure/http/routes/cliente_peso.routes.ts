import { Hono } from "hono";
import { ClientePesoController } from "../controllers/ClientePesoController";

export const clientePesoRoutes = new Hono();
const controller = new ClientePesoController();

clientePesoRoutes.get("/", (c) => controller.list(c));
clientePesoRoutes.get("/:id", (c) => controller.getById(c));
clientePesoRoutes.post("/", (c) => controller.create(c));
clientePesoRoutes.put("/:id", (c) => controller.update(c));
clientePesoRoutes.delete("/:id", (c) => controller.delete(c));
