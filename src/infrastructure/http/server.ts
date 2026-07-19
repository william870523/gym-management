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
import { authAdmin, authDevice, authAny } from "./middleware/auth.middleware";
import { rateLimit, getClientIp } from "./middleware/rate-limit.middleware";
import { authRoutes } from "./routes/auth.routes";
import { syncRoutes } from "./routes/sync.routes";
import { catalogsRoutes } from "./routes/catalogs.routes";
import { gymsRoutes } from "./routes/gyms.routes";
import { clientsRoutes } from "./routes/clients.routes";
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
import membershipRequestRoutes from "./routes/membership-request.routes";
import retentionRoutes from "./routes/retention.routes";
import { getRemoteTimeStatus } from "../time/time.service";

const app = new Hono();

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

const adminProtected = new Hono();
adminProtected.use("*", authAdmin());
adminProtected.use("*", adminLimiter);
adminProtected.route("/", catalogsRoutes());
app.route("/catalogs", adminProtected);

const gymsProtected = new Hono();
gymsProtected.use("*", authAdmin());
gymsProtected.use("*", adminLimiter);
gymsProtected.route("/", gymsRoutes());
app.route("/gyms", gymsProtected);

const clientsProtected = new Hono();
clientsProtected.use("*", authAdmin());
clientsProtected.use("*", adminLimiter);
clientsProtected.route("/", clientsRoutes());
app.route("/clients", clientsProtected);

const trainersProtected = new Hono();
trainersProtected.use("*", authAdmin());
trainersProtected.use("*", adminLimiter);
trainersProtected.route("/", trainersRoutes());
app.route("/trainers", trainersProtected);

const paymentsProtected = new Hono();
paymentsProtected.use("*", authAdmin());
paymentsProtected.use("*", adminLimiter);
paymentsProtected.route("/", paymentsRoutes());
app.route("/payments", paymentsProtected);

const usersProtected = new Hono();
usersProtected.use("*", authAny());
usersProtected.use("*", adminLimiter);
usersProtected.route("/", usersRoutes());
app.route("/users", usersProtected);

const nacionalidadesProtected = new Hono();
nacionalidadesProtected.use("*", authAdmin());
nacionalidadesProtected.use("*", adminLimiter);
nacionalidadesProtected.route("/", nacionalidadRoutes);
app.route("/nacionalidades", nacionalidadesProtected);

const monedasProtected = new Hono();
monedasProtected.use("*", authAdmin());
monedasProtected.use("*", adminLimiter);
monedasProtected.route("/", monedaRoutes);
app.route("/monedas", monedasProtected);

const tiposPagoProtected = new Hono();
tiposPagoProtected.use("*", authAdmin());
tiposPagoProtected.use("*", adminLimiter);
tiposPagoProtected.route("/", tipoPagoRoutes);
app.route("/tipos-pago", tiposPagoProtected);

const tiposCambioProtected = new Hono();
tiposCambioProtected.use("*", authAdmin());
tiposCambioProtected.use("*", adminLimiter);
tiposCambioProtected.route("/", tipoCambioRoutes);
app.route("/tipos-cambio", tiposCambioProtected);

const referenciasProtected = new Hono();
referenciasProtected.use("*", authAdmin());
referenciasProtected.use("*", adminLimiter);
referenciasProtected.route("/", referenciaRoutes);
app.route("/referencias", referenciasProtected);

const horariosProtected = new Hono();
horariosProtected.use("*", authAdmin());
horariosProtected.use("*", adminLimiter);
horariosProtected.route("/", horarioRoutes);
app.route("/horarios", horariosProtected);

const planesPagoProtected = new Hono();
planesPagoProtected.use("*", authAdmin());
planesPagoProtected.use("*", adminLimiter);
planesPagoProtected.route("/", planesPagoRoutes);
app.route("/planes-pago", planesPagoProtected);

const cuentasProtected = new Hono();
cuentasProtected.use("*", authAdmin());
cuentasProtected.use("*", adminLimiter);
cuentasProtected.route("/", cuentaRoutes);
app.route("/cuentas", cuentasProtected);

const entrenadoresProtected = new Hono();
entrenadoresProtected.use("*", authAdmin());
entrenadoresProtected.use("*", adminLimiter);
entrenadoresProtected.route("/", entrenadorRoutes);
app.route("/entrenadores", entrenadoresProtected);

const clientesProtectedRoutes = new Hono();
clientesProtectedRoutes.use("*", authAdmin());
clientesProtectedRoutes.use("*", adminLimiter);
clientesProtectedRoutes.route("/", clienteRoutes);
app.route("/clientes", clientesProtectedRoutes);

const clientesPesoProtected = new Hono();
clientesPesoProtected.use("*", authAdmin());
clientesPesoProtected.use("*", adminLimiter);
clientesPesoProtected.route("/", clientePesoRoutes);
app.route("/cliente-pesos", clientesPesoProtected);

const asistenciasProtected = new Hono();
asistenciasProtected.use("*", authAdmin());
asistenciasProtected.use("*", adminLimiter);
asistenciasProtected.route("/", asistenciaRoutes);
app.route("/asistencias", asistenciasProtected);

const pagosClienteProtected = new Hono();
pagosClienteProtected.use("*", authAdmin());
pagosClienteProtected.use("*", adminLimiter);
pagosClienteProtected.route("/", pagoClienteRoutes);
app.route("/pagos-cliente", pagosClienteProtected);
app.route("/pagos", pagosClienteProtected);

const detallesPagoProtected = new Hono();
detallesPagoProtected.use("*", authAdmin());
detallesPagoProtected.use("*", adminLimiter);
detallesPagoProtected.route("/", detallePagoRoutes);
app.route("/detalles-pago", detallesPagoProtected);

const configuracionProtected = new Hono();
configuracionProtected.use("*", authAdmin());
configuracionProtected.use("*", adminLimiter);
configuracionProtected.route("/", configuracionRoutes);
app.route("/configuracion", configuracionProtected);

const accountingProtected = new Hono();
accountingProtected.use("*", authAny());
accountingProtected.use("*", adminLimiter);
accountingProtected.route("/", accountingRoutes);
app.route("/contabilidad", accountingProtected);

const membershipRequestsProtected = new Hono();
membershipRequestsProtected.use("*", authAny());
membershipRequestsProtected.use("*", adminLimiter);
membershipRequestsProtected.route("/", membershipRequestRoutes);
app.route("/membresias/solicitudes", membershipRequestsProtected);

const retentionProtected = new Hono();
retentionProtected.use("*", authAny());
retentionProtected.use("*", adminLimiter);
retentionProtected.route("/", retentionRoutes);
app.route("/retencion", retentionProtected);

logger.info(`Starting REMOTE API on port ${env.port}...`);

export default {
  port: env.port,
  fetch: app.fetch,
};
