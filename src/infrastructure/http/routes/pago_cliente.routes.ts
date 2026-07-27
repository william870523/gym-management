import { Hono } from "hono";
import { PagoClienteController } from "../controllers/PagoClienteController";
import { paymentWriteGone } from "./payment-write.guard";
import { requireAdmin } from "../middleware/auth.middleware";

export const pagoClienteRoutes = new Hono();
const controller = new PagoClienteController();

pagoClienteRoutes.get("/", (c) => controller.list(c));
pagoClienteRoutes.get("/cliente/:ci", (c) => controller.listByClient(c));
// Cotización del recargo por mora (docs/RECARGO_MORA.md). Antes de "/:id"
// para que no la capture la ruta por identificador.
pagoClienteRoutes.get("/recargo-mora/quote", (c) => controller.recargoMoraQuote(c));
pagoClienteRoutes.get("/:id", (c) => controller.getById(c));
pagoClienteRoutes.post("/", paymentWriteGone);
// Cobrar es el trabajo de recepción (R5.6: el cobro queda a nombre de quien lo
// hizo). Anular y borrar no: son de administración, igual que en la fixture
// donde Ana cobra y Carla anula.
pagoClienteRoutes.post("/process", (c) => controller.process(c));
pagoClienteRoutes.put("/:id", paymentWriteGone);
pagoClienteRoutes.post("/:id/reversar", requireAdmin(), (c) => controller.reverse(c));
pagoClienteRoutes.delete("/:id", requireAdmin(), (c) => controller.delete(c));
