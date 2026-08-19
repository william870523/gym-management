import { Hono } from "hono";
import {
  deleteAccesoMultisedeCliente,
  getAccesoMultisedeCliente,
  getCotizacionDeVisitante,
  getPrecioAccesoMultisede,
  listarVisitantes,
  postAccesoMultisedeCliente,
  postCobroAccesoMultisede,
  postCobroCruzado,
  putPrecioAccesoMultisede,
} from "../controllers/acceso-multisede.controller";
import { requirePlatformAuthority } from "./global-catalog-authority";

export const accesoMultisedeRoutes = new Hono();

// El precio lo lee cualquier sede —necesita saber qué cobrar— y solo lo cambia
// el Dueño de la cadena. `requirePlatformAuthority` va aquí además del control
// del propio controlador: el guardia de la ruta es el que se ve al auditar.
accesoMultisedeRoutes.get("/precio", getPrecioAccesoMultisede);
accesoMultisedeRoutes.put("/precio", requirePlatformAuthority, putPrecioAccesoMultisede);

// Antes que `/clientes/:ci`: si no, «visitantes» se leería como una cédula.
accesoMultisedeRoutes.get("/visitantes", listarVisitantes);
// M4c — el cobro cruzado. La consulta va aparte del cobro a propósito: el
// mostrador necesita saber el importe ANTES de pulsar, y enseñarlo después de
// haberlo cobrado no sirve para decidir.
accesoMultisedeRoutes.get("/visitantes/:ci/cotizacion", getCotizacionDeVisitante);
accesoMultisedeRoutes.post("/visitantes/:ci/cobro", postCobroCruzado);
accesoMultisedeRoutes.get("/clientes/:ci", getAccesoMultisedeCliente);
accesoMultisedeRoutes.post("/clientes/:ci", postAccesoMultisedeCliente);
// M4b: la venta del plus. Separada de la marca porque mueve dinero.
accesoMultisedeRoutes.post("/clientes/:ci/cobro", postCobroAccesoMultisede);
accesoMultisedeRoutes.delete("/clientes/:ci", deleteAccesoMultisedeCliente);
