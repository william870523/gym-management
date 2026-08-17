import { Hono } from "hono";
import {
  deleteAccesoMultisedeCliente,
  getAccesoMultisedeCliente,
  getPrecioAccesoMultisede,
  listarVisitantes,
  postAccesoMultisedeCliente,
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
accesoMultisedeRoutes.get("/clientes/:ci", getAccesoMultisedeCliente);
accesoMultisedeRoutes.post("/clientes/:ci", postAccesoMultisedeCliente);
accesoMultisedeRoutes.delete("/clientes/:ci", deleteAccesoMultisedeCliente);
