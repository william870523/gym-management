import { Hono } from "hono";
import { PagoClienteController } from "../controllers/PagoClienteController";
import { paymentWriteGone } from "./payment-write.guard";

export const pagoClienteRoutes = new Hono();
const controller = new PagoClienteController();

pagoClienteRoutes.get("/", (c) => controller.list(c));
pagoClienteRoutes.get("/cliente/:ci", (c) => controller.listByClient(c));
pagoClienteRoutes.get("/:id", (c) => controller.getById(c));
pagoClienteRoutes.post("/", paymentWriteGone);
pagoClienteRoutes.post("/process", (c) => controller.process(c));
pagoClienteRoutes.put("/:id", paymentWriteGone);
pagoClienteRoutes.post("/:id/reversar", (c) => controller.reverse(c));
pagoClienteRoutes.delete("/:id", (c) => controller.delete(c));
