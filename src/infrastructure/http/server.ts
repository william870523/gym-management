// gym-remote-api/src/infrastructure/http/server.ts
// NOTA DE PRODUCCIÓN:
// Este servidor debe ejecutarse detrás de un reverse proxy (Nginx/Caddy)
// en entornos de producción. El proxy maneja:
// - Terminación TLS/SSL
// - Compresión
// - Rate limiting
// - Headers de seguridad
// El servidor Bun solo debe escuchar en localhost (127.0.0.1)
// Ver: docs/DEPLOYMENT_HTTPS.md para configuración completa

import { Hono } from "hono";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { securityHeaders } from "../../config/security";
import { corsMiddleware } from "../../config/cors";
import {
  authAdmin,
  authDevice,
  authUser,
  requireAdminForWrites,
  requireAnyPermission,
  requirePermission,
  requirePermissionByMethod,
  requireStaff,
} from "./middleware/auth.middleware";
import { rateLimit, getClientIp } from "./middleware/rate-limit.middleware";
import { authRoutes } from "./routes/auth.routes";
import { syncRoutes } from "./routes/sync.routes";
import { catalogsRoutes } from "./routes/catalogs.routes";
import * as catalogs from "./controllers/catalogs.controller";
import { gymsRoutes } from "./routes/gyms.routes";
import { clientsRoutes } from "./routes/clients.routes";
import { accesoMultisedeRoutes } from "./routes/acceso-multisede.routes";
import { cierreCadenaRoutes } from "./routes/cierre-cadena.routes";
import { saldoEnlaceRoutes } from "./routes/saldo-enlace.routes";
import { trainersRoutes } from "./routes/trainers.routes";
import { paymentsRoutes } from "./routes/payments.routes";
import { usersRoutes } from "./routes/users.routes";
import { nacionalidadRoutes } from "./routes/nacionalidad.routes";
import { monedaRoutes } from "./routes/moneda.routes";
import { tipoPagoRoutes } from "./routes/tipo_pago.routes";
import { tipoCambioRoutes } from "./routes/tipo_cambio.routes";
import { referenciaRoutes } from "./routes/referencia.routes";
import { horarioRoutes } from "./routes/horario.routes";
import { planesPagoRoutes } from "./routes/planes_pago.routes";
import { cuentaRoutes } from "./routes/cuenta.routes";
import { entrenadorRoutes } from "./routes/entrenador.routes";
import { clienteRoutes } from "./routes/cliente.routes";
import { clientePesoRoutes } from "./routes/cliente_peso.routes";
import { asistenciaRoutes } from "./routes/asistencia.routes";
import { pagoClienteRoutes } from "./routes/pago_cliente.routes";
import { detallePagoRoutes } from "./routes/detalle_pago.routes";
import { configuracionRoutes } from "./routes/configuracion.routes";
import { accountingRoutes } from "./routes/accounting.routes";
import { planCuotaRoutes } from "./routes/plan_cuota.routes";
import membershipRequestRoutes from "./routes/membership-request.routes";
import retentionRoutes from "./routes/retention.routes";
import estadisticasRoutes from "./routes/estadisticas.routes";
import { estadoDelBarrido } from "../startup/barrido-programado";
import { estadoDeLaAuditoriaDeSellos } from "../startup/auditoria-sellos-programada";
import { getRemoteTimeStatus } from "../time/time.service";

export const app = new Hono();

// Rate Limiters Configuration
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,
  keyGenerator: (c) => getClientIp(c),
  name: "auth",
});

const syncLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  keyGenerator: (c) => {
    const auth = c.get("auth");
    return auth?.sub || `device:${getClientIp(c)}`;
  },
  name: "sync",
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  keyGenerator: (c) => {
    const auth = c.get("auth");
    return auth?.sub || `user:${getClientIp(c)}`;
  },
  name: "admin",
});

// Cabeceras de seguridad
app.use("*", securityHeaders);
app.use("*", corsMiddleware());

// Logging simple
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  logger.info(`${c.req.method} ${c.req.path} - ${ms}ms`);
});

// Reloj público: no expone datos sensibles y permite calibrar instalaciones.
app.get("/system/time", async (c) =>
  c.json(await getRemoteTimeStatus(c.req.query("gym_id"))),
);
app.get("/health", async (c) =>
  c.json({
    status: "ok-remote",
    time: await getRemoteTimeStatus(c.req.query("gym_id")),
    // Sin esto, «el barrido no encontró nada» y «el barrido no corrió» se leen
    // igual desde fuera, que es como se pasaron meses sin que corriera.
    barrido_visitantes: estadoDelBarrido(),
    auditoria_sellos: estadoDeLaAuditoriaDeSellos(),
  }),
);

// Rutas principales
const authProtected = new Hono();
authProtected.use("*", authLimiter);
authProtected.route("/", authRoutes());
app.route("/auth", authProtected);

// Protected Routes - aplicar middleware dentro de grupos
const syncProtected = new Hono();
syncProtected.use("*", authDevice());
syncProtected.use("*", syncLimiter);
syncProtected.route("/", syncRoutes());
app.route("/sync", syncProtected);

// Política de acceso de la web (docs/REMOTE_ROLE_SCOPE.md).
//
// La web es la aplicación completa: si a una sede se le rompe el escritorio,
// su recepcionista abre el navegador, entra con SU cuenta y sigue trabajando.
// Por eso el ámbito ya no se decide en la puerta del edificio —"o eres admin o
// no entras"— sino en cada puerta:
//
//   authUser()               sesión revalidada contra la base; el rol que manda
//                            es el persistido, nunca el claim del token.
//   requireStaff()           administración o recepción. Un rol desconocido no
//                            pasa: se mantiene el fallo cerrado.
//   requireAdminForWrites()  catálogos y maestros: recepción consulta, solo
//                            administración modifica.
//   authAdmin()              lo que sigue siendo exclusivo de administración.
//
// Las acciones que recepción no debe hacer dentro de un grupo abierto (anular
// un cobro, borrar) llevan `requireAdmin()` en su propia ruta.
const catalogsProtected = new Hono();
catalogsProtected.use("*", authUser());
catalogsProtected.use("*", requirePermissionByMethod("clientes.leer", "configuracion.escribir"));
catalogsProtected.use("*", adminLimiter);
catalogsProtected.route("/", catalogsRoutes());
app.route("/catalogs", catalogsProtected);

// Sedes: la lectura la hace cualquier miembro del personal —necesita saber en
// qué sede está—, y crear o dar de baja es del **Dueño de la cadena**, que lo
// comprueba el propio controlador. No va con `authAdmin` porque el Dueño no
// tiene por qué ser administración de una sede concreta.
const gymsProtected = new Hono();
gymsProtected.use("*", authUser());
gymsProtected.use("*", requirePermission("clientes.leer"));
gymsProtected.use("*", adminLimiter);
gymsProtected.route("/", gymsRoutes());
app.route("/gyms", gymsProtected);

const clientsProtected = new Hono();
clientsProtected.use("*", authUser());
clientsProtected.use("*", requirePermissionByMethod("clientes.leer", "clientes.escribir"));
clientsProtected.use("*", adminLimiter);
clientsProtected.route("/", clientsRoutes());
app.route("/clients", clientsProtected);

// M4a — acceso multi-sede. Se lee con `clientes.leer` y se marca con
// `clientes.escribir`, porque marcar es un dato del socio y lo hace recepción
// (docs/MULTI_SEDE.md §9, segunda ronda, respuesta 1). Cambiar el PRECIO no
// entra por esta puerta: lo guarda `requirePlatformAuthority` en la propia ruta,
// que es la autoridad de cadena y no un permiso de sede.
const accesoMultisedeProtected = new Hono();
accesoMultisedeProtected.use("*", authUser());
accesoMultisedeProtected.use(
  "*",
  requirePermissionByMethod("clientes.leer", "clientes.escribir"),
);
accesoMultisedeProtected.use("*", adminLimiter);
accesoMultisedeProtected.route("/", accesoMultisedeRoutes);
app.route("/acceso-multisede", accesoMultisedeProtected);

// M5 — la solicitud de cierre de la cadena (docs/MULTI_SEDE.md §6.2). Se lee
// con `tesoreria.cerrar` porque quien va a cerrar es quien necesita verla; la
// autoridad de cadena para pedirla y retirarla la pone cada ruta.
const cierreCadenaProtected = new Hono();
cierreCadenaProtected.use("*", authUser());
cierreCadenaProtected.use("*", requirePermissionByMethod("tesoreria.cerrar", "tesoreria.cerrar"));
cierreCadenaProtected.use("*", adminLimiter);
cierreCadenaProtected.route("/", cierreCadenaRoutes);
app.route("/cierre-cadena", cierreCadenaProtected);

// M8 — el saldo entre sedes y su liquidación (docs/MULTI_SEDE.md §5.4). Mismo
// permiso que el cierre: quien cuadra el dinero de la cadena es quien mira lo
// que una sede le debe a otra. La autoridad de cadena la pone cada ruta.
const saldoEnlaceProtected = new Hono();
saldoEnlaceProtected.use("*", authUser());
saldoEnlaceProtected.use("*", requirePermissionByMethod("tesoreria.cerrar", "tesoreria.cerrar"));
saldoEnlaceProtected.use("*", adminLimiter);
saldoEnlaceProtected.route("/", saldoEnlaceRoutes);
app.route("/saldo-enlace", saldoEnlaceProtected);

const trainersProtected = new Hono();
trainersProtected.use("*", authUser());
trainersProtected.use("*", requirePermissionByMethod("clientes.leer", "entrenadores.gestionar"));
trainersProtected.use("*", adminLimiter);
trainersProtected.route("/", trainersRoutes());
app.route("/trainers", trainersProtected);

const paymentsProtected = new Hono();
paymentsProtected.use("*", authUser());
paymentsProtected.use("*", requirePermissionByMethod("clientes.leer", "cobros.registrar"));
paymentsProtected.use("*", adminLimiter);
paymentsProtected.route("/", paymentsRoutes());
app.route("/payments", paymentsProtected);

const usersProtected = new Hono();
usersProtected.use("*", authUser());
usersProtected.use("*", requirePermission("configuracion.escribir"));
usersProtected.use("*", adminLimiter);
usersProtected.route("/", usersRoutes());
app.route("/users", usersProtected);

const nacionalidadesProtected = new Hono();
nacionalidadesProtected.use("*", authUser());
nacionalidadesProtected.use("*", requirePermissionByMethod("clientes.leer", "configuracion.escribir"));
nacionalidadesProtected.use("*", adminLimiter);
nacionalidadesProtected.route("/", nacionalidadRoutes);
app.route("/nacionalidades", nacionalidadesProtected);

const monedasProtected = new Hono();
monedasProtected.use("*", authUser());
monedasProtected.use("*", requirePermissionByMethod("clientes.leer", "configuracion.escribir"));
monedasProtected.use("*", adminLimiter);
monedasProtected.route("/", monedaRoutes);
app.route("/monedas", monedasProtected);

const tiposPagoProtected = new Hono();
tiposPagoProtected.use("*", authUser());
tiposPagoProtected.use("*", requirePermissionByMethod("clientes.leer", "configuracion.escribir"));
tiposPagoProtected.use("*", adminLimiter);
tiposPagoProtected.route("/", tipoPagoRoutes);
app.route("/tipos-pago", tiposPagoProtected);

const tiposCambioProtected = new Hono();
tiposCambioProtected.use("*", authUser());
tiposCambioProtected.use("*", requirePermissionByMethod("clientes.leer", "configuracion.escribir"));
tiposCambioProtected.use("*", adminLimiter);
tiposCambioProtected.route("/", tipoCambioRoutes);
app.route("/tipos-cambio", tiposCambioProtected);

const referenciasProtected = new Hono();
referenciasProtected.use("*", authUser());
referenciasProtected.use("*", requirePermissionByMethod("clientes.leer", "configuracion.escribir"));
referenciasProtected.use("*", adminLimiter);
referenciasProtected.route("/", referenciaRoutes);
app.route("/referencias", referenciasProtected);

const horariosProtected = new Hono();
horariosProtected.use("*", authUser());
horariosProtected.use("*", requirePermissionByMethod("clientes.leer", "configuracion.escribir"));
horariosProtected.use("*", adminLimiter);
horariosProtected.route("/", horarioRoutes);
app.route("/horarios", horariosProtected);

/**
 * E0-b — motivos de baja, también en la raíz.
 *
 * De los nueve catálogos que sirve esta API, ocho responden en la raíz **y**
 * bajo `/catalogs`; este solo respondía bajo `/catalogs`. El cliente Flutter
 * —que es el mismo binario para escritorio y web— llama a `/motivos-baja`,
 * así que la vista del catálogo funcionaba en escritorio y devolvía **404 en
 * la web**: un flujo administrativo que no existía en el remoto, justo lo que
 * la continuidad operativa no admite.
 *
 * Se reutilizan los mismos manejadores que `/catalogs/motivos-baja`; no hay
 * lógica duplicada, solo el prefijo que faltaba.
 */
const motivosBajaProtected = new Hono();
motivosBajaProtected.use("*", authUser());
motivosBajaProtected.use("*", requirePermissionByMethod("estadisticas.leer", "configuracion.escribir"));
motivosBajaProtected.use("*", adminLimiter);
motivosBajaProtected.get("/", catalogs.getMotivosBaja);
motivosBajaProtected.get("/:id", catalogs.getMotivoBajaById);
motivosBajaProtected.post("/", catalogs.createMotivoBaja);
motivosBajaProtected.put("/:id", catalogs.updateMotivoBaja);
motivosBajaProtected.delete("/:id", catalogs.deleteMotivoBaja);
app.route("/motivos-baja", motivosBajaProtected);

// R5.2 — cuotas del cliente. Va montado en la raíz porque sus rutas cuelgan de
// dos prefijos (`/planes-pago/...` y `/membresias/...`), igual que en local.
//
// Se registra ANTES que `/planes-pago`, que exige admin para todo su prefijo:
// si fuera después, recepción recibiría 403 al leer el esquema de cuotas de un
// plan y la ventana de cobro se quedaría sin poder ofrecer el pago por cuotas.
// Aquí la lectura es para recepción y definir el esquema exige admin, que se
// comprueba dentro del handler.
const planCuotaProtected = new Hono();
planCuotaProtected.use("*", authUser());
planCuotaProtected.use("*", requirePermission("clientes.leer"));
planCuotaProtected.use("*", adminLimiter);
planCuotaProtected.route("/", planCuotaRoutes);
app.route("/", planCuotaProtected);

const planesPagoProtected = new Hono();
planesPagoProtected.use("*", authUser());
planesPagoProtected.use("*", requirePermissionByMethod("clientes.leer", "configuracion.escribir"));
planesPagoProtected.use("*", adminLimiter);
planesPagoProtected.route("/", planesPagoRoutes);
app.route("/planes-pago", planesPagoProtected);

const cuentasProtected = new Hono();
cuentasProtected.use("*", authUser());
cuentasProtected.use("*", requirePermissionByMethod("clientes.leer", "configuracion.escribir"));
cuentasProtected.use("*", adminLimiter);
cuentasProtected.route("/", cuentaRoutes);
app.route("/cuentas", cuentasProtected);

const entrenadoresProtected = new Hono();
entrenadoresProtected.use("*", authUser());
entrenadoresProtected.use("*", requirePermissionByMethod("clientes.leer", "entrenadores.gestionar"));
entrenadoresProtected.use("*", adminLimiter);
entrenadoresProtected.route("/", entrenadorRoutes);
app.route("/entrenadores", entrenadoresProtected);

const clientesProtectedRoutes = new Hono();
clientesProtectedRoutes.use("*", authUser());
clientesProtectedRoutes.use("*", requirePermissionByMethod("clientes.leer", "clientes.escribir"));
clientesProtectedRoutes.use("*", adminLimiter);
clientesProtectedRoutes.route("/", clienteRoutes);
app.route("/clientes", clientesProtectedRoutes);

const clientesPesoProtected = new Hono();
clientesPesoProtected.use("*", authUser());
clientesPesoProtected.use("*", requirePermissionByMethod("clientes.leer", "clientes.escribir"));
clientesPesoProtected.use("*", adminLimiter);
clientesPesoProtected.route("/", clientePesoRoutes);
app.route("/cliente-pesos", clientesPesoProtected);

const asistenciasProtected = new Hono();
asistenciasProtected.use("*", authUser());
asistenciasProtected.use("*", requirePermissionByMethod("clientes.leer", "clientes.escribir"));
asistenciasProtected.use("*", adminLimiter);
asistenciasProtected.route("/", asistenciaRoutes);
app.route("/asistencias", asistenciasProtected);

const pagosClienteProtected = new Hono();
pagosClienteProtected.use("*", authUser());
pagosClienteProtected.use("*", requirePermissionByMethod("clientes.leer", "cobros.registrar"));
pagosClienteProtected.use("*", adminLimiter);
pagosClienteProtected.route("/", pagoClienteRoutes);
app.route("/pagos-cliente", pagosClienteProtected);
app.route("/pagos", pagosClienteProtected);

const detallesPagoProtected = new Hono();
detallesPagoProtected.use("*", authUser());
detallesPagoProtected.use("*", requireAdminForWrites());
detallesPagoProtected.use("*", adminLimiter);
detallesPagoProtected.route("/", detallePagoRoutes);
app.route("/detalles-pago", detallesPagoProtected);

const configuracionProtected = new Hono();
configuracionProtected.use("*", authUser());
configuracionProtected.use("*", requirePermission("configuracion.escribir"));
configuracionProtected.use("*", adminLimiter);
configuracionProtected.route("/", configuracionRoutes);
app.route("/configuracion", configuracionProtected);

// Cada handler contable vuelve a exigir el permiso exacto; este guard exterior
// solo descarta de entrada los roles sin ninguna capacidad contable.
const accountingProtected = new Hono();
accountingProtected.use("*", authUser());
accountingProtected.use("*", requireAnyPermission(
  "tesoreria.cerrar",
  "gastos.gobernar",
  "estadisticas.leer",
));
accountingProtected.use("*", adminLimiter);
accountingProtected.route("/", accountingRoutes);
app.route("/contabilidad", accountingProtected);

const membershipRequestsProtected = new Hono();
membershipRequestsProtected.use("*", authUser());
membershipRequestsProtected.use("*", requirePermissionByMethod("clientes.leer", "clientes.escribir"));
membershipRequestsProtected.use("*", adminLimiter);
membershipRequestsProtected.route("/", membershipRequestRoutes);
app.route("/membresias/solicitudes", membershipRequestsProtected);

const retentionProtected = new Hono();
retentionProtected.use("*", authUser());
retentionProtected.use("*", requirePermission("estadisticas.leer"));
retentionProtected.use("*", adminLimiter);
retentionProtected.route("/", retentionRoutes);
app.route("/retencion", retentionProtected);

// R6 — perfiles estadísticos. La identidad tenant ya fue revalidada por
// `authUser`; los handlers consumen exclusivamente `auth.gymId`.
const estadisticasProtected = new Hono();
estadisticasProtected.use("*", authUser());
estadisticasProtected.use("*", requirePermission("estadisticas.leer"));
estadisticasProtected.use("*", adminLimiter);
estadisticasProtected.route("/", estadisticasRoutes);
app.route("/estadisticas", estadisticasProtected);


logger.info(`Starting REMOTE API on port ${env.port}...`);

export default {
  port: env.port,
  fetch: app.fetch,
};
