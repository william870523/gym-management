import { Hono } from "hono";
import {
  getLiquidaciones,
  getSaldoPendiente,
  postLiquidacion,
} from "../controllers/saldo-enlace.controller";
import { requirePlatformAuthority } from "./global-catalog-authority";

export const saldoEnlaceRoutes = new Hono();

// El saldo de una sede llega con la sede por parámetro —la misma excepción al
// §3.3 que el detalle por sede—, así que este guardia es lo único que separa
// una consulta legítima de un agujero de aislamiento.
saldoEnlaceRoutes.get("/pendientes", requirePlatformAuthority, getSaldoPendiente);
saldoEnlaceRoutes.get("/liquidaciones", requirePlatformAuthority, getLiquidaciones);
// Registrar que el dinero se movió toca DOS negocios: uno declara que pagó y el
// otro que cobró. Si la sede deudora pudiera anotarlo sola, podría declararse al
// día sin que la acreedora se enterara, y solo se descubriría cuando alguien
// echara de menos el dinero. Quien arbitra entre las dos es el concentrador.
saldoEnlaceRoutes.post("/liquidaciones", requirePlatformAuthority, postLiquidacion);
