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
import { authAdmin, authDevice } from "./middleware/auth.middleware";
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

const app = new Hono();

// Cabeceras de seguridad
app.use("*", securityHeaders);

// Logging simple
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  logger.info(`${c.req.method} ${c.req.path} - ${ms}ms`);
});

// Healthcheck
app.get("/health", (c) => c.json({ status: "ok-remote" }));

// Rutas principales
app.route("/auth", authRoutes());

// Protected Routes - aplicar middleware dentro de grupos
const syncProtected = new Hono();
syncProtected.use("*", authDevice());
syncProtected.route("/", syncRoutes());
app.route("/sync", syncProtected);

const adminProtected = new Hono();
adminProtected.use("*", authAdmin());
adminProtected.route("/", catalogsRoutes());
app.route("/catalogs", adminProtected);

const gymsProtected = new Hono();
gymsProtected.use("*", authAdmin());
gymsProtected.route("/", gymsRoutes());
app.route("/gyms", gymsProtected);

const clientsProtected = new Hono();
clientsProtected.use("*", authAdmin());
clientsProtected.route("/", clientsRoutes());
app.route("/clients", clientsProtected);

const trainersProtected = new Hono();
trainersProtected.use("*", authAdmin());
trainersProtected.route("/", trainersRoutes());
app.route("/trainers", trainersProtected);

const paymentsProtected = new Hono();
paymentsProtected.use("*", authAdmin());
paymentsProtected.route("/", paymentsRoutes());
app.route("/payments", paymentsProtected);

const usersProtected = new Hono();
usersProtected.use("*", authAdmin());
usersProtected.route("/", usersRoutes());
app.route("/users", usersProtected);

const nacionalidadesProtected = new Hono();
nacionalidadesProtected.use("*", authAdmin());
nacionalidadesProtected.route("/", nacionalidadRoutes);
app.route("/nacionalidades", nacionalidadesProtected);

const monedasProtected = new Hono();
monedasProtected.use("*", authAdmin());
monedasProtected.route("/", monedaRoutes);
app.route("/monedas", monedasProtected);

const tiposPagoProtected = new Hono();
tiposPagoProtected.use("*", authAdmin());
tiposPagoProtected.route("/", tipoPagoRoutes);
app.route("/tipos-pago", tiposPagoProtected);

const tiposCambioProtected = new Hono();
tiposCambioProtected.use("*", authAdmin());
tiposCambioProtected.route("/", tipoCambioRoutes);
app.route("/tipos-cambio", tiposCambioProtected);

const referenciasProtected = new Hono();
referenciasProtected.use("*", authAdmin());
referenciasProtected.route("/", referenciaRoutes);
app.route("/referencias", referenciasProtected);

const horariosProtected = new Hono();
horariosProtected.use("*", authAdmin());
horariosProtected.route("/", horarioRoutes);
app.route("/horarios", horariosProtected);

const planesPagoProtected = new Hono();
planesPagoProtected.use("*", authAdmin());
planesPagoProtected.route("/", planesPagoRoutes);
app.route("/planes-pago", planesPagoProtected);

const cuentasProtected = new Hono();
cuentasProtected.use("*", authAdmin());
cuentasProtected.route("/", cuentaRoutes);
app.route("/cuentas", cuentasProtected);

const entrenadoresProtected = new Hono();
entrenadoresProtected.use("*", authAdmin());
entrenadoresProtected.route("/", entrenadorRoutes);
app.route("/entrenadores", entrenadoresProtected);

const clientesProtectedRoutes = new Hono();
clientesProtectedRoutes.use("*", authAdmin());
clientesProtectedRoutes.route("/", clienteRoutes);
app.route("/clientes", clientesProtectedRoutes);

const clientesPesoProtected = new Hono();
clientesPesoProtected.use("*", authAdmin());
clientesPesoProtected.route("/", clientePesoRoutes);
app.route("/clientes-peso", clientesPesoProtected);

const asistenciasProtected = new Hono();
asistenciasProtected.use("*", authAdmin());
asistenciasProtected.route("/", asistenciaRoutes);
app.route("/asistencias", asistenciasProtected);

const pagosClienteProtected = new Hono();
pagosClienteProtected.use("*", authAdmin());
pagosClienteProtected.route("/", pagoClienteRoutes);
app.route("/pagos-cliente", pagosClienteProtected);

const detallesPagoProtected = new Hono();
detallesPagoProtected.use("*", authAdmin());
detallesPagoProtected.route("/", detallePagoRoutes);
app.route("/detalles-pago", detallesPagoProtected);

logger.info(`Starting REMOTE API on port ${env.port}...`);

export default {
  port: env.port,
  fetch: app.fetch
};
