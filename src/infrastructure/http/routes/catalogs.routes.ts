import { Hono } from "hono";
import * as catalogs from "../controllers/catalogs.controller";

export function catalogsRoutes() {
    const app = new Hono();

    // Moneda
    app.get("/monedas", catalogs.getMonedas);
    app.get("/monedas/:id", catalogs.getMonedaById);
    app.post("/monedas", catalogs.createMoneda);
    app.put("/monedas/:id", catalogs.updateMoneda);
    app.delete("/monedas/:id", catalogs.deleteMoneda);

    // Nacionalidad
    app.get("/nacionalidades", catalogs.getNacionalidades);
    app.get("/nacionalidades/:id", catalogs.getNacionalidadById);
    app.post("/nacionalidades", catalogs.createNacionalidad);
    app.put("/nacionalidades/:id", catalogs.updateNacionalidad);
    app.delete("/nacionalidades/:id", catalogs.deleteNacionalidad);

    // TipoPago
    app.get("/tipos-pago", catalogs.getTiposPago);
    app.get("/tipos-pago/:id", catalogs.getTipoPagoById);
    app.post("/tipos-pago", catalogs.createTipoPago);
    app.put("/tipos-pago/:id", catalogs.updateTipoPago);
    app.delete("/tipos-pago/:id", catalogs.deleteTipoPago);

    // TipoCambio
    app.get("/tipos-cambio", catalogs.getTiposCambio);
    app.get("/tipos-cambio/:id", catalogs.getTipoCambioById);
    app.post("/tipos-cambio", catalogs.createTipoCambio);
    app.put("/tipos-cambio/:id", catalogs.updateTipoCambio);
    app.delete("/tipos-cambio/:id", catalogs.deleteTipoCambio);

    // Referencia
    app.get("/referencias", catalogs.getReferencias);
    app.get("/referencias/:id", catalogs.getReferenciaById);
    app.post("/referencias", catalogs.createReferencia);
    app.put("/referencias/:id", catalogs.updateReferencia);
    app.delete("/referencias/:id", catalogs.deleteReferencia);

    // MotivoBaja (E0-b) — acotado por sede desde el token.
    app.get("/motivos-baja", catalogs.getMotivosBaja);
    app.get("/motivos-baja/:id", catalogs.getMotivoBajaById);
    app.post("/motivos-baja", catalogs.createMotivoBaja);
    app.put("/motivos-baja/:id", catalogs.updateMotivoBaja);
    app.delete("/motivos-baja/:id", catalogs.deleteMotivoBaja);

    // Horario
    app.get("/horarios", catalogs.getHorarios);
    app.get("/horarios/:id", catalogs.getHorarioById);
    app.post("/horarios", catalogs.createHorario);
    app.put("/horarios/:id", catalogs.updateHorario);
    app.delete("/horarios/:id", catalogs.deleteHorario);

    // PlanesPago
    app.get("/planes-pago", catalogs.getPlanesPago);
    app.get("/planes-pago/:id", catalogs.getPlanPagoById);
    app.post("/planes-pago", catalogs.createPlanPago);
    app.put("/planes-pago/:id", catalogs.updatePlanPago);
    app.delete("/planes-pago/:id", catalogs.deletePlanPago);

    // Cuenta
    app.get("/cuentas", catalogs.getCuentas);
    app.get("/cuentas/:id", catalogs.getCuentaById);
    app.post("/cuentas", catalogs.createCuenta);
    app.put("/cuentas/:id", catalogs.updateCuenta);
    app.delete("/cuentas/:id", catalogs.deleteCuenta);

    return app;
}
