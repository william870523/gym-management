/**
 * R5.6 — mitad remota de la evidencia de sincronización del cobrador.
 *
 *   bun run verify:payment-collector-sync -- --pago <id>   # comprueba lo subido
 *   bun run verify:payment-collector-sync -- --crear       # cobra aquí, para bajarlo
 *
 * El cobro remoto se hace con el **caso de uso real**, con un `User` activo de
 * la sede: es lo que el navegador ejecuta cuando cobra una recepcionista.
 */
import { prisma } from "../src/infrastructure/db/prismaClient";
import { ProcessPaymentUseCase } from "../src/application/use-cases/pago_cliente/ProcessPaymentUseCase";
import { PrismaPagoClienteRepository } from "../src/infrastructure/repositories/PrismaPagoClienteRepository";
import { PrismaPlanesPagoRepository } from "../src/infrastructure/repositories/PrismaPlanesPagoRepository";
import { PrismaClienteRepository } from "../src/infrastructure/repositories/PrismaClienteRepository";
import { trustedClock } from "../src/config/trusted-clock";
import {
  DEMO_CLIENTES,
  DEMO_GYM_ID,
  DEMO_PLAN_IDS,
  DEMO_USERS,
  installDemoPaymentCollectorData,
} from "../../scripts/demo-payment-collector";

const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;

function printCollector(label: string, row: any) {
  console.log(
    `${label.padEnd(22)} ${row?.cobrado_por_nombre_snapshot ?? "—"} ` +
      `(${row?.cobrado_por_origen ?? "sin origen"}) · id ${row?.cobrado_por_user_id ?? "—"}`,
  );
}

async function comprobar(pagoId: string) {
  const pago = await prisma.pagoCliente.findFirst({
    where: { pago_cliente_id: pagoId, gym_id: gymId },
  });
  if (!pago) {
    console.log(`El cobro ${pagoId} NO llegó a MariaDB.`);
    return;
  }
  const movimientos = await prisma.tesoreriaMovimiento.findMany({
    where: { gym_id: gymId, origen_id: pagoId },
  });
  const log = await prisma.syncLog.findFirst({
    where: { entidad: "pago_cliente", entidad_id: pagoId },
    orderBy: { id: "desc" },
    select: { id: true, device_id: true },
  });

  console.log(`cobro en MariaDB     : ${pago.pago_cliente_id} · ${pago.monto_total}`);
  printCollector("pago remoto", pago);
  for (const movimiento of movimientos) {
    printCollector(`movimiento ${movimiento.direccion}`, movimiento);
  }
  console.log(
    `sync_log             : id ${log?.id ?? "—"} · subido por ${log?.device_id ?? "—"}`,
  );
  console.log(
    "\nEl dispositivo que sube el evento no aparece como cobrador: el actor\n" +
      "es el que congeló la instalación donde se cobró.",
  );
}

async function crear() {
  const fixture = await installDemoPaymentCollectorData(prisma, gymId);
  const moneda = await prisma.moneda.findFirst({ where: { codigo: "CUP" } });
  const pago = await new ProcessPaymentUseCase(
    new PrismaPagoClienteRepository(),
    new PrismaPlanesPagoRepository(),
    new PrismaClienteRepository(),
  ).execute(
    {
      ci: DEMO_CLIENTES.tres,
      id_planes_pago: DEMO_PLAN_IDS.completo,
      moneda_id: moneda!.moneda_id,
      monto_total: 30,
      fecha: trustedClock.nowUtc().toISOString(),
      detalles: [{
        tipo_pago_id: fixture.tipoPago,
        moneda_id: moneda!.moneda_id,
        cuenta_id: fixture.cuenta,
        cantidad: 30,
      }],
    } as any,
    gymId,
    DEMO_USERS.ana,
  );
  const guardado = await prisma.pagoCliente.findUnique({
    where: { pago_cliente_id: pago.pago_cliente_id },
  });
  const log = await prisma.syncLog.findFirst({
    where: { entidad: "pago_cliente", entidad_id: pago.pago_cliente_id },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  console.log(`cobro remoto         : ${pago.pago_cliente_id}`);
  printCollector("pago remoto", guardado);
  console.log(`sync_log             : id ${log?.id ?? "—"}`);
  console.log(
    `\nDescargarlo en SQLite:\n` +
      `  cd E:\\bun\\gym-local-api ; bun run verify:payment-collector-sync -- --down --pago ${pago.pago_cliente_id}`,
  );
}

try {
  const pagoIndex = process.argv.indexOf("--pago");
  if (process.argv.includes("--crear")) {
    await crear();
  } else if (pagoIndex >= 0 && process.argv[pagoIndex + 1]) {
    await comprobar(process.argv[pagoIndex + 1]!);
  } else {
    console.log(
      "Uso: bun run verify:payment-collector-sync -- --pago <id> | --crear",
    );
  }
} finally {
  await prisma.$disconnect();
}
