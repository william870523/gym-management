/**
 * Saneamiento puntual de PD-4.
 *
 * Alinea exclusivamente las dos filas observadas en el recorrido del
 * 03-08-2026. No recrea eventos ni modifica datos de negocio: solo lleva el
 * contador `version` de 1 a 2 después de comprobar que ambas filas están
 * eliminadas y pertenecen al pago esperado.
 *
 * Vista previa: bun --preload ./src/config/tz-preload.ts scripts/repair-pd4-delete-versions.ts
 * Aplicar:      bun --preload ./src/config/tz-preload.ts scripts/repair-pd4-delete-versions.ts --apply
 */
import { prisma } from "../src/infrastructure/db/prismaClient";

const TARGET_VERSION = 2;
const PAIRS = [
  {
    paymentId: "ffae4bf0-21ad-47c9-bf8f-d4bc0aa51a44",
    applicationId: "d19f481b-6174-4c3e-9d20-c34447d7c1d4",
  },
  {
    paymentId: "58a6c2ed-9ffa-4b19-ae65-62f7068e1e77",
    applicationId: "893b266a-e7db-4487-a09e-6283f55a6adb",
  },
] as const;

async function inspect(pair: (typeof PAIRS)[number]) {
  const [payment, application] = await Promise.all([
    prisma.pagoCliente.findUnique({
      where: { pago_cliente_id: pair.paymentId },
      select: {
        pago_cliente_id: true,
        gym_id: true,
        is_deleted: true,
        version: true,
        deleted_at: true,
      },
    }),
    prisma.pagoMembresiaAplicacion.findUnique({
      where: { aplicacion_id: pair.applicationId },
      select: {
        aplicacion_id: true,
        pago_cliente_id: true,
        gym_id: true,
        is_deleted: true,
        version: true,
        deleted_at: true,
      },
    }),
  ]);
  return { payment, application };
}

function assertExpected(
  rows: Awaited<ReturnType<typeof inspect>>,
  pair: (typeof PAIRS)[number],
) {
  const { payment, application } = rows;
  if (!payment || !application) {
    throw new Error("PD-4: no se encontraron las dos filas exactas a sanear.");
  }
  if (
    application.pago_cliente_id !== pair.paymentId ||
    !payment.gym_id ||
    payment.gym_id !== application.gym_id ||
    !payment.is_deleted ||
    !application.is_deleted ||
    !payment.deleted_at ||
    !application.deleted_at
  ) {
    throw new Error(
      "PD-4: las filas no corresponden al mismo pago eliminado y gimnasio; se aborta.",
    );
  }
  for (const version of [payment.version, application.version]) {
    if (version !== 1 && version !== TARGET_VERSION) {
      throw new Error(
        `PD-4: versión inesperada ${version}; solo se admite 1 o ${TARGET_VERSION}.`,
      );
    }
  }
}

async function main() {
  const before = await Promise.all(PAIRS.map((pair) => inspect(pair)));
  before.forEach((rows, index) => assertExpected(rows, PAIRS[index]!));
  console.log("PD-4 antes", JSON.stringify(before));

  if (!process.argv.includes("--apply")) {
    console.log("Vista previa: no se modificaron filas. Use --apply para sanear.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const pair of PAIRS) {
      await tx.pagoCliente.updateMany({
        where: {
          pago_cliente_id: pair.paymentId,
          is_deleted: true,
          version: 1,
        },
        data: { version: TARGET_VERSION },
      });
      await tx.pagoMembresiaAplicacion.updateMany({
        where: {
          aplicacion_id: pair.applicationId,
          pago_cliente_id: pair.paymentId,
          is_deleted: true,
          version: 1,
        },
        data: { version: TARGET_VERSION },
      });
    }
  });

  const after = await Promise.all(PAIRS.map((pair) => inspect(pair)));
  after.forEach((rows, index) => {
    assertExpected(rows, PAIRS[index]!);
    if (
      rows.payment?.version !== TARGET_VERSION ||
      rows.application?.version !== TARGET_VERSION
    ) {
      throw new Error("PD-4: la transacción terminó sin alcanzar version=2.");
    }
  });
  console.log("PD-4 después", JSON.stringify(after));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
