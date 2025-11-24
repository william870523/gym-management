import { Hono } from "hono";
import * as payments from "../controllers/payments.controller";

export function paymentsRoutes() {
    const app = new Hono();

    // PagoCliente
    app.get("/pagos", payments.getPagosCliente);
    app.get("/pagos/:id", payments.getPagoClienteById);
    app.post("/pagos", payments.createPagoCliente);
    app.put("/pagos/:id", payments.updatePagoCliente);
    app.delete("/pagos/:id", payments.deletePagoCliente);

    // DetallePago
    app.get("/detalles-pago", payments.getDetallesPago);
    app.get("/detalles-pago/:id", payments.getDetallePagoById);
    app.post("/detalles-pago", payments.createDetallePago);
    app.put("/detalles-pago/:id", payments.updateDetallePago);
    app.delete("/detalles-pago/:id", payments.deleteDetallePago);

    return app;
}
