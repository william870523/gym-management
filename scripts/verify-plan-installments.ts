/**
 * Verificación de R5.2 contra MariaDB.
 *
 * Paridad con `gym-local-api/scripts/verify-plan-installments.ts`: reinstala la
 * fixture compartida y cobra de verdad la cuota 2 del socio atrasado con el
 * caso de uso remoto. Imprime los mismos valores normalizados para poder
 * compararlos línea a línea con los de local.
 *
 *   bun run verify:plan-installments
 */
import { prisma } from "../src/infrastructure/db/prismaClient";
import { trustedClock } from "../src/config/trusted-clock";
import { ProcessPaymentUseCase } from "../src/application/use-cases/pago_cliente/ProcessPaymentUseCase";
import { PrismaPagoClienteRepository } from "../src/infrastructure/repositories/PrismaPagoClienteRepository";
import { PrismaPlanesPagoRepository } from "../src/infrastructure/repositories/PrismaPlanesPagoRepository";
import { PrismaClienteRepository } from "../src/infrastructure/repositories/PrismaClienteRepository";
import {
  DEMO_CLIENTES,
  DEMO_GYM_ID,
  DEMO_MEMBRESIA_IDS,
  DEMO_MONEDA,
  installDemoPlanInstallmentsData,
} from "../../scripts/demo-plan-installments";

const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;
const fixture = await installDemoPlanInstallmentsData(prisma, gymId);
console.log(`Gym    : ${gymId} (MariaDB)`);
console.log("Fixture: reinstalada\n");

const moneda = await prisma.moneda.findFirst({ where: { codigo: DEMO_MONEDA } });
const membresiaId = DEMO_MEMBRESIA_IDS.atrasada;

// R5.6: el cobro exige cobrador autenticado. La verificación usa una cuenta
// propia y determinista, no un usuario cualquiera de la base.
const COBRADOR_ID = "verify-plan-installments-cobrador";
await prisma.user.upsert({
  where: { user_id: COBRADOR_ID },
  update: { active: true, gym_id: gymId },
  create: {
    user_id: COBRADOR_ID,
    user_nombre: "verify.cuotas",
    user_email: "verify.cuotas@demo.local",
    password: "DEMO-SIN-CLAVE",
    role: "recepcionista",
    active: true,
    gym_id: gymId,
  },
});

const antes = await prisma.membresiaCliente.findUnique({
  where: { membresia_id: membresiaId },
});
console.log(`importe_pagado ANTES : ${String(antes?.importe_pagado)}`);

const useCase = () => new ProcessPaymentUseCase(
  new PrismaPagoClienteRepository(),
  new PrismaPlanesPagoRepository(),
  new PrismaClienteRepository(),
);

const cobro = (numeroCuota: number) => useCase().execute(
  {
    ci: DEMO_CLIENTES.atrasada,
    id_planes_pago: antes!.id_planes_pago,
    moneda_id: moneda!.moneda_id,
    monto_total: 10,
    fecha: trustedClock.nowUtc().toISOString(),
    modo_cuotas: true,
    numero_cuota: numeroCuota,
    membresia_id: membresiaId,
    detalles: [{
      tipo_pago_id: fixture.tipoPago,
      moneda_id: moneda!.moneda_id,
      cuenta_id: fixture.cuenta,
      cantidad: 10,
    }],
  } as any,
  gymId,
  COBRADOR_ID,
);

const salto = await cobro(3).then(() => null).catch((e: Error) => e.message);
console.log(`saltar a la cuota 3  : ${salto ?? "SE PERMITIÓ (mal)"}`);

const pago = await cobro(2);

const despues = await prisma.membresiaCliente.findUnique({
  where: { membresia_id: membresiaId },
});
const cuotas = await prisma.membresiaCuota.findMany({
  where: { membresia_id: membresiaId },
  orderBy: { numero_cuota: "asc" },
});
const movimientos = await prisma.tesoreriaMovimiento.findMany({
  where: { gym_id: gymId, origen_id: pago.pago_cliente_id },
  select: { direccion: true, concepto: true, monto: true },
});

console.log(`\ncobro                : ${pago.pago_cliente_id}`);
console.log(`monto_total          : ${String(
  (await prisma.pagoCliente.findUnique({ where: { pago_cliente_id: pago.pago_cliente_id } }))?.monto_total,
)}`);
console.log(`importe_pagado DESPUÉS: ${String(despues?.importe_pagado)}`);
console.log(`estados de cuota     : ${cuotas.map((c) => c.estado).join(", ")}`);
console.log(
  `fecha_fin membresía  : ${despues?.fecha_fin.toISOString().slice(0, 10)}` +
  ` (fin del tramo 2: ${cuotas[1]?.fecha_cobertura_fin.toISOString().slice(0, 10)})`,
);
console.log(
  `tesorería            : ${movimientos.map((m) => `${m.direccion} ${m.concepto} ${String(m.monto)}`).join(" | ")}`,
);

await prisma.$disconnect();
