import { Hono } from "hono";
import * as catalogs from "../controllers/catalogs.controller";
import { requirePlatformAuthority } from "./global-catalog-authority";

export function catalogsRoutes() {
    const app = new Hono();

    // Moneda
    app.get("/monedas", catalogs.getMonedas);
    app.get("/monedas/:id", catalogs.getMonedaById);
    app.post("/monedas", requirePlatformAuthority, catalogs.createMoneda);
    app.put("/monedas/:id", requirePlatformAuthority, catalogs.updateMoneda);
    app.delete("/monedas/:id", requirePlatformAuthority, catalogs.deleteMoneda);

    // Nacionalidad
    app.get("/nacionalidades", catalogs.getNacionalidades);
    app.get("/nacionalidades/:id", catalogs.getNacionalidadById);
    app.post("/nacionalidades", requirePlatformAuthority, catalogs.createNacionalidad);
    app.put("/nacionalidades/:id", requirePlatformAuthority, catalogs.updateNacionalidad);
    app.delete("/nacionalidades/:id", requirePlatformAuthority, catalogs.deleteNacionalidad);

    // TipoPago
    app.get("/tipos-pago", catalogs.getTiposPago);
    app.get("/tipos-pago/:id", catalogs.getTipoPagoById);
    app.post("/tipos-pago", requirePlatformAuthority, catalogs.createTipoPago);
    app.put("/tipos-pago/:id", requirePlatformAuthority, catalogs.updateTipoPago);
    app.delete("/tipos-pago/:id", requirePlatformAuthority, catalogs.deleteTipoPago);

    // TipoCambio
    app.get("/tipos-cambio", catalogs.getTiposCambio);
    app.get("/tipos-cambio/:id", catalogs.getTipoCambioById);
    app.post("/tipos-cambio", requirePlatformAuthority, catalogs.createTipoCambio);
    app.put("/tipos-cambio/:id", requirePlatformAuthority, catalogs.updateTipoCambio);
    app.delete("/tipos-cambio/:id", requirePlatformAuthority, catalogs.deleteTipoCambio);

    // Referencia
    app.get("/referencias", catalogs.getReferencias);
    app.get("/referencias/:id", catalogs.getReferenciaById);
    app.post("/referencias", requirePlatformAuthority, catalogs.createReferencia);
    app.put("/referencias/:id", requirePlatformAuthority, catalogs.updateReferencia);
    app.delete("/referencias/:id", requirePlatformAuthority, catalogs.deleteReferencia);

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
