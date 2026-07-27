/**
 * Verificación de la línea «recargos condonados» del cierre diario
 * (docs/RECARGO_MORA.md §6-bis) contra MariaDB.
 *
 * Paridad con `gym-local-api/scripts/verify-recargos-condonados.ts`: no escribe
 * filas con Prisma, hace un COBRO REAL por `POST /pagos/process` con la
 * condonación marcada y después lee `GET /contabilidad/treasury-ledger`. Así se
 * ejercita también el token (de donde sale quién condona y el gimnasio).
 *
 *   bun run verify:recargos-condonados
 */
import { app } from "../src/infrastructure/http/server";
import { JwtService } from "../src/infrastructure/auth/jwt.service";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { trustedClock } from "../src/config/trusted-clock";
import { CompensationProfileService } from "../src/application/accounting/compensation-profile.service";
import {
  DEMO_CLIENT_ATRASADO_CI,
  DEMO_GYM_ID,
  DEMO_IDS,
  installDemoRecargoMoraData,
} from "../../scripts/demo-recargo-mora";

const MOTIVO = "Socio hospitalizado, autorizado";

async function main() {
  const gymId = DEMO_GYM_ID;
  console.log(`Gym    : ${gymId} (MariaDB)`);

  await installDemoRecargoMoraData(prisma, gymId);
  console.log("Fixture: reinstalada (el cliente vuelve a estar atrasado).\n");

  const operator = await prisma.user.findFirst({
    where: { gym_id: gymId, active: true, is_deleted: false, role: "admin" },
  });
  if (!operator) throw new Error("No hay usuario admin en este gimnasio.");
  const token = JwtService.signAdminToken({
    userId: operator.user_id,
    role: operator.role,
    gymId,
  });
  console.log(`Operador: ${operator.user_nombre} (${operator.user_id})`);

  const plan = await prisma.planesPago.findUnique({
    where: { id_planes_pago: DEMO_IDS.planPct },
  });
  if (!plan) throw new Error("Falta el plan PMR-PCT de la fixture.");
  const paymentType = await prisma.tipoPago.findFirst({
    where: { is_deleted: false },
  });
  const account = await prisma.cuenta.findFirst({
    where: { gym_id: gymId, moneda_id: plan.moneda_id, is_deleted: false },
  });
  if (!paymentType || !account) {
    throw new Error("Falta un tipo de pago o una cuenta en la moneda del plan.");
  }

  const response = await app.request("/pagos/process", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      ci: DEMO_CLIENT_ATRASADO_CI,
      id_planes_pago: plan.id_planes_pago,
      moneda_id: plan.moneda_id,
      monto_total: plan.importe_plan_pago,
      fecha: trustedClock.nowUtc().toISOString(),
      condonar_recargo_mora: true,
      motivo_condonacion_recargo: MOTIVO,
      detalles: [
        {
          tipo_pago_id: paymentType.tipo_pago_id,
          moneda_id: plan.moneda_id,
          cuenta_id: account.cuenta_id,
          cantidad: plan.importe_plan_pago,
        },
      ],
    }),
  });
  const payment = await response.json();
  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`El cobro falló (${response.status}): ${JSON.stringify(payment)}`);
  }
  const paymentId = payment.pago_cliente_id ?? payment.data?.pago_cliente_id;
  console.log(`Cobro  : ${paymentId}`);

  const businessDate = await prisma.$transaction((tx) =>
    new CompensationProfileService().businessDateForInstant(
      tx,
      gymId,
      trustedClock.nowUtc(),
    ),
  );
  const day = businessDate.toISOString().slice(0, 10);

  const ledgerResponse = await app.request(
    `/contabilidad/treasury-ledger?fecha=${day}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const ledger = await ledgerResponse.json();
  if (ledgerResponse.status !== 200) {
    throw new Error(
      `El cierre falló (${ledgerResponse.status}): ${JSON.stringify(ledger)}`,
    );
  }

  console.log(`\nCierre del ${ledger.fecha_negocio}`);
  console.log("Resumen de caja (lo condonado NO entra aquí):");
  for (const row of ledger.resumen_monedas) {
    console.log(`  ${row.moneda_codigo}  +${row.entradas}  -${row.salidas}  neto ${row.neto}`);
  }
  console.log("\nrecargos_condonados:");
  console.log(JSON.stringify(ledger.recargos_condonados, null, 2));

  const mine = ledger.recargos_condonados.detalle.find(
    (row: any) => row.pago_cliente_id === paymentId,
  );
  if (!mine) throw new Error("El cobro condonado NO aparece en el cierre.");
  if (mine.condonado_por_user_id !== operator.user_id) {
    throw new Error(
      `El actor no salió del token: ${mine.condonado_por_user_id}`,
    );
  }
  console.log(
    `\nOK: ${mine.socio} · ${mine.moneda_codigo} ${mine.importe} · ${mine.motivo}` +
      ` · autorizó ${mine.condonado_por}`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
