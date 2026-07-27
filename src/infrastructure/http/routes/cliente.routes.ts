import { Hono } from "hono";
import { ClienteController } from "../controllers/ClienteController";
import { requireAdmin } from "../middleware/auth.middleware";

export const clienteRoutes = new Hono();
const controller = new ClienteController();

clienteRoutes.get("/", (c) => controller.list(c));
clienteRoutes.get("/:id/expediente", (c) => controller.getRecord(c));
// Pausar y reanudar una membresía es administración; recepción lo pide por
// `/membresias/solicitudes`, que es justo lo que ofrece su expediente.
clienteRoutes.post("/:id/membresias/:membershipId/pausar", requireAdmin(), (c) => controller.pauseMembership(c));
clienteRoutes.post("/:id/membresias/:membershipId/reanudar", requireAdmin(), (c) => controller.resumeMembership(c));
clienteRoutes.get("/:id", (c) => controller.getById(c));
// Registrar y corregir socios es el trabajo de recepción; darlos de baja no.
clienteRoutes.post("/", (c) => controller.create(c));
clienteRoutes.put("/:id", (c) => controller.update(c));
clienteRoutes.delete("/:id", requireAdmin(), (c) => controller.delete(c));
