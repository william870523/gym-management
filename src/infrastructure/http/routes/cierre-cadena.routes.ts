import { Hono } from "hono";
import {
  getCertificadosDeCierre,
  getConsolidadoDeCierre,
  getSemaforoDeCierre,
  listarSolicitudesDeCierre,
  postCertificadoDeCierre,
  postRetiroDeSolicitud,
  postSolicitudDeCierre,
} from "../controllers/cierre-cadena.controller";
import { requirePlatformAuthority } from "./global-catalog-authority";

export const cierreCadenaRoutes = new Hono();

// Leerla puede cualquier sede: necesita saber qué se le está pidiendo. Pedirla
// y retirarla es autoridad de cadena, y el guardia va en la ruta porque es el
// que se ve al auditar (mismo criterio que el precio del plus, M4a).
cierreCadenaRoutes.get("/solicitudes", listarSolicitudesDeCierre);
// El semáforo enseña a TODAS las sedes a la vez, así que mirarlo es de la
// cadena: una sede no tiene por qué saber si la vecina cerró.
cierreCadenaRoutes.get("/semaforo", requirePlatformAuthority, getSemaforoDeCierre);
// El informe agregado suma el dinero de todas las sedes: misma autoridad.
cierreCadenaRoutes.get(
  "/consolidado",
  requirePlatformAuthority,
  getConsolidadoDeCierre,
);
// Firmar el certificado es el acto de cadena por excelencia: congela el dinero
// de todas las sedes en una foto que ya no cambia.
cierreCadenaRoutes.get("/certificados", requirePlatformAuthority, getCertificadosDeCierre);
cierreCadenaRoutes.post("/certificados", requirePlatformAuthority, postCertificadoDeCierre);
cierreCadenaRoutes.post("/solicitudes", requirePlatformAuthority, postSolicitudDeCierre);
cierreCadenaRoutes.post(
  "/solicitudes/:solicitudId/retiro",
  requirePlatformAuthority,
  postRetiroDeSolicitud,
);
