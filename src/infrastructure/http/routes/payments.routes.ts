import { Hono } from "hono";
import * as payments from "../controllers/payments.controller";
import { paymentWriteGone } from "./payment-write.guard";

export function paymentsRoutes() {
    const app = new Hono();

    // PagoCliente
    app.get("/pagos", payments.getPagosCliente);
    app.get("/pagos/:id", payments.getPagoClienteById);
    app.post("/pagos", paymentWriteGone);
    app.put("/pagos/:id", paymentWriteGone);
    app.delete("/pagos/:id", paymentWriteGone);

    // DetallePago
    app.get("/detalles-pago", payments.getDetallesPago);
    app.get("/detalles-pago/:id", payments.getDetallePagoById);
    app.post("/detalles-pago", paymentWriteGone);
    app.put("/detalles-pago/:id", paymentWriteGone);
    app.delete("/detalles-pago/:id", paymentWriteGone);

    return app;
}
