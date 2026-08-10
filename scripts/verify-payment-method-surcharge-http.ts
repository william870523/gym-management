import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { env } from "../src/config/env";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { usuarioSedeId } from "../src/application/auth/usuario-sede";
import { trustedClock } from "../src/config/trusted-clock";
import {
  R51_PROOF_CLIENT_CI, R51_GYM_ID, R51_IDS,
  installDemoPaymentMethodSurcharge,
  removeDemoPaymentMethodSurcharge,
} from "../../scripts/demo-payment-method-surcharge";

const password = process.env.R51_VERIFY_PASSWORD;
if (!password) throw new Error("Defina R51_VERIFY_PASSWORD para la cuenta efímera.");
const userId = "r51-verifier-remote";
const email = "r51.verifier.remote@demo.local";
const membershipId = usuarioSedeId(userId, R51_GYM_ID);

async function json(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body as any;
}

try {
  await removeDemoPaymentMethodSurcharge(prisma, R51_GYM_ID);
  await installDemoPaymentMethodSurcharge(prisma, R51_GYM_ID);
  await prisma.user.upsert({
    where: { user_id: userId },
    create: { user_id: userId, user_nombre: "Verificador R5.1", user_email: email,
      password: await bcrypt.hash(password, 10), role: "reception", active: true,
      is_deleted: false, gym_id: R51_GYM_ID },
    update: { user_email: email, password: await bcrypt.hash(password, 10),
      role: "reception", active: true, is_deleted: false, gym_id: R51_GYM_ID },
  });
  const now = trustedClock.nowUtc();
  await prisma.usuarioSede.upsert({
    where: { usuario_sede_id: membershipId },
    create: { usuario_sede_id: membershipId, user_id: userId,
      gym_id: R51_GYM_ID, rol: "reception", activo: true, is_deleted: false,
      source_device: "R51_HTTP_VERIFICATION", created_at: now, updated_at: now },
    update: { rol: "reception", activo: true, is_deleted: false,
      deleted_at: null, updated_at: now },
  });
  const baseUrl = `http://127.0.0.1:${env.port}`;
  const login = await json(await fetch(`${baseUrl}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }));
  const headers = { "content-type": "application/json", authorization: `Bearer ${login.token}`,
    "x-gym-id": R51_GYM_ID };
  const plan = await prisma.planesPago.findUniqueOrThrow({ where: { id_planes_pago: R51_IDS.plan } });
  const account = await prisma.cuenta.findUniqueOrThrow({ where: { cuenta_id: R51_IDS.account } });
  const methodQuote = async (totalReceived: string) => json(await fetch(`${baseUrl}/pagos/recargo-metodo/quote`, {
    method: "POST", headers,
    body: JSON.stringify({ total_recibido: totalReceived, tipo_pago_id: R51_IDS.paymentType,
      cuenta_id: R51_IDS.account, moneda_pago_id: account.moneda_id,
      moneda_plan_id: plan.moneda_id, tipo_cambio_id: R51_IDS.rate }),
  }));
  const shortQuote = await methodQuote("10.00");
  const quote = await methodQuote("11.00");
  const paymentBody = (amount: number, id = randomUUID()) => ({
    pago_cliente_id: id, ci: R51_PROOF_CLIENT_CI, fecha: new Date().toISOString(),
    monto_total: 4500, id_planes_pago: R51_IDS.plan, moneda_id: plan.moneda_id,
    detalles: [{ detalle_pago_id: randomUUID(), pago_cliente_id: id,
      tipo_pago_id: R51_IDS.paymentType, moneda_id: account.moneda_id,
      cuenta_id: R51_IDS.account, cantidad: amount, tipo_cambio_id: R51_IDS.rate,
      recargo_metodo_base: "10.00",
      recargo_metodo_tasa_version: quote.tipo_cambio_version }],
  });
  const tampered = await fetch(`${baseUrl}/pagos/process`, {
    method: "POST", headers, body: JSON.stringify(paymentBody(10)),
  });
  if (tampered.status !== 409) throw new Error(`El total manipulado respondió ${tampered.status}, no 409.`);
  const created = await json(await fetch(`${baseUrl}/pagos/process`, {
    method: "POST", headers, body: JSON.stringify(paymentBody(11)),
  }));
  const detail = await prisma.detallePago.findFirstOrThrow({
    where: { pago_cliente_id: created.pago_cliente_id },
  });
  const movement = await prisma.tesoreriaMovimiento.findFirstOrThrow({
    where: { origen_id: created.pago_cliente_id, origen_tipo: "PAGO_CLIENTE" },
  });
  console.log(JSON.stringify({ destino: "MariaDB remota",
    cotizacion_corta: shortQuote, cotizacion_completa: quote,
    rechazo_total_manipulado: tampered.status,
    pago: { id: created.pago_cliente_id, monto_total: created.monto_total },
    detalle: { cantidad: detail.cantidad, base: detail.recargo_metodo_base,
      pct: detail.recargo_metodo_pct, recargo: detail.recargo_metodo_importe,
      total: detail.recargo_metodo_total, politica: detail.recargo_metodo_politica,
      tasa_version: detail.recargo_metodo_tasa_version },
    tesoreria: { entrada: movement.monto, cambio_inventado: false },
  }, null, 2));
} finally {
  await prisma.usuarioSede.deleteMany({ where: { usuario_sede_id: membershipId } });
  await prisma.user.deleteMany({ where: { user_id: userId } });
  await prisma.$disconnect();
}
