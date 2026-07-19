import { Hono } from "hono";
import { DetallePagoController } from "../controllers/DetallePagoController";
import { paymentWriteGone } from "./payment-write.guard";

export const detallePagoRoutes = new Hono();
const controller = new DetallePagoController();

detallePagoRoutes.get("/", (c) => controller.list(c));
detallePagoRoutes.get("/:id", (c) => controller.getById(c));
detallePagoRoutes.post("/", paymentWriteGone);
detallePagoRoutes.put("/:id", paymentWriteGone);
detallePagoRoutes.delete("/:id", paymentWriteGone);
