// TEMPORAL: envía al endpoint remoto el payload EXACTO que arma el diálogo de
// cobro de Flutter para una cuota, y muestra la respuesta.
import { JwtService } from "../src/infrastructure/auth/jwt.service";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { randomUUID } from "crypto";
import {
  DEMO_CLIENTES,
  DEMO_GYM_ID,
  DEMO_MEMBRESIA_IDS,
  DEMO_MONEDA,
} from "../../scripts/demo-plan-installments";

const gymId = DEMO_GYM_ID;
const op = await prisma.user.findFirst({
  where: { gym_id: gymId, active: true, is_deleted: false, role: "admin" },
});
const token = JwtService.signAdminToken({
  userId: op!.user_id,
  role: op!.role,
  gymId,
});

const membership = await prisma.membresiaCliente.findUnique({
  where: { membresia_id: DEMO_MEMBRESIA_IDS.atrasada },
});
const moneda = await prisma.moneda.findFirst({ where: { codigo: DEMO_MONEDA } });
const tp = await prisma.tipoPago.findFirst({
  where: { is_deleted: false },
  orderBy: { tipo_pago_id: "asc" },
});
const acc = await prisma.cuenta.findFirst({
  where: { gym_id: gymId, moneda_id: moneda!.moneda_id, is_deleted: false },
  orderBy: { cuenta_id: "asc" },
});

const pagoId = randomUUID();
const detalleId = randomUUID();

// Tal cual lo serializa PaymentModel.toJson() + los `extra` del diálogo.
const body = {
  pago_cliente_id: pagoId,
  ci: DEMO_CLIENTES.atrasada,
  fecha: new Date().toISOString(),
  monto_total: 10,
  id_entrenador: null,
  id_planes_pago: membership!.id_planes_pago,
  moneda_id: moneda!.moneda_id,
  membresia_id: membership!.membresia_id,
  is_deleted: false,
  version: 1,
  detalles: [
    {
      detalle_pago_id: detalleId,
      pago_cliente_id: pagoId,
      tipo_pago_id: tp!.tipo_pago_id,
      moneda_id: moneda!.moneda_id,
      cuenta_id: acc!.cuenta_id,
      cantidad: 10,
    },
  ],
  modo_cuotas: true,
  numero_cuota: 2,
};

console.log(`plan enviado     : ${body.id_planes_pago}`);
console.log(`membresía enviada: ${body.membresia_id}`);

const r = await fetch("http://localhost:3001/pagos/process", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(body),
});
console.log(`\nstatus: ${r.status}`);
console.log((await r.text()).slice(0, 700));

await prisma.$disconnect();
