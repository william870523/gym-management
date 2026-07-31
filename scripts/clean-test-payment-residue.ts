/**
 * Retira del `sync_log` únicamente los eventos efímeros publicados por las
 * pruebas remotas PCC/PCI. Las filas de negocio ya son eliminadas por el
 * `afterAll` de esas pruebas; conservar sus eventos permite que la API local
 * resucite la historia de prueba.
 *
 * Simulación:
 *   bun --preload ./src/config/tz-preload.ts scripts/clean-test-payment-residue.ts
 *
 * Aplicación (exige un dump MariaDB existente):
 *   $env:TEST_PAYMENT_RESIDUE_REMOTE_BACKUP='E:\...\backup.sql'
 *   bun --preload ./src/config/tz-preload.ts scripts/clean-test-payment-residue.ts --apply
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const APPLY = process.argv.includes("--apply");
const TEST_CIS = ["PCC000000001", "PCI000000001", "PRC000000001"];
const BACKUP = process.env.TEST_PAYMENT_RESIDUE_REMOTE_BACKUP;
const manifestIndex = process.argv.indexOf("--manifest");
const MANIFEST = manifestIndex >= 0
  ? resolve(process.argv[manifestIndex + 1]!)
  : resolve(
      import.meta.dir,
      "../../docs/evidence/r6-ranking-parity/test-payment-residue-manifest.json",
    );

const logs = await prisma.syncLog.findMany({
  where: {
    OR: [
      { entidad_id: { in: TEST_CIS } },
      { payload_json: { contains: TEST_CIS[0] } },
      { payload_json: { contains: TEST_CIS[1] } },
    ],
  },
  select: {
    id: true,
    entidad: true,
    operacion: true,
    entidad_id: true,
    payload_json: true,
    created_at: true,
  },
  orderBy: { id: "asc" },
});

const businessCounts = {
  clients: await prisma.cliente.count({ where: { ci: { in: TEST_CIS } } }),
  memberships: await prisma.membresiaCliente.count({
    where: { ci: { in: TEST_CIS } },
  }),
  payments: await prisma.pagoCliente.count({
    where: { ci: { in: TEST_CIS } },
  }),
};
const maxLog = await prisma.syncLog.aggregate({ _max: { id: true } });
const byEntity = logs.reduce<Record<string, number>>((result, row) => {
  result[row.entidad] = (result[row.entidad] ?? 0) + 1;
  return result;
}, {});
const payloads = logs.map((row) => {
  try {
    return JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    throw new Error(`El sync_log ${row.id} no contiene JSON válido.`);
  }
});
const unique = (values: Array<string | null | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
const manifest = {
  generatedAtUtc: new Date().toISOString(),
  clientCis: TEST_CIS.filter((ci) =>
    logs.some(
      (row) => row.entidad_id === ci || row.payload_json.includes(ci),
    )
  ),
  logIds: logs.map((row) => row.id),
  membershipIds: unique([
    ...logs
      .filter((row) => row.entidad === "membresia_cliente")
      .map((row) => row.entidad_id),
    ...payloads.map((payload) => String(payload.membresia_id ?? "") || null),
  ]),
  paymentIds: unique([
    ...logs
      .filter((row) => row.entidad === "pago_cliente")
      .map((row) => row.entidad_id),
    ...payloads.map((payload) => String(payload.pago_cliente_id ?? "") || null),
    ...payloads.map((payload) => String(payload.origen_id ?? "") || null),
  ]),
  detailIds: unique(
    payloads.map((payload) => String(payload.origen_detalle_id ?? "") || null),
  ),
  movementIds: unique(
    logs
      .filter((row) => row.entidad === "tesoreria_movimiento")
      .map((row) => row.entidad_id),
  ),
};

console.log(JSON.stringify({
  logs: logs.length,
  firstId: logs[0]?.id ?? null,
  lastId: logs.at(-1)?.id ?? null,
  currentMaxId: maxLog._max.id,
  byEntity,
  businessCounts,
  manifest: {
    path: MANIFEST,
    memberships: manifest.membershipIds.length,
    payments: manifest.paymentIds.length,
    details: manifest.detailIds.length,
    movements: manifest.movementIds.length,
  },
}, null, 2));

if (logs.length > 0) {
  mkdirSync(resolve(MANIFEST, ".."), { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

if (Object.values(businessCounts).some((count) => count !== 0)) {
  throw new Error(
    "MariaDB todavía conserva filas PCC/PCI; este saneamiento solo puede retirar su rastro huérfano.",
  );
}

if (!APPLY) {
  console.log("\nSimulación: crea un dump y usa --apply.");
  await prisma.$disconnect();
  process.exit(0);
}

if (!BACKUP || !existsSync(BACKUP)) {
  throw new Error(
    "TEST_PAYMENT_RESIDUE_REMOTE_BACKUP debe apuntar a un dump MariaDB existente.",
  );
}

const removed = await prisma.$transaction(async (tx) => {
  return tx.syncLog.deleteMany({
    where: { id: { in: logs.map((row) => row.id) } },
  });
});

console.log(`\nBackup MariaDB: ${BACKUP}`);
console.log(`Eventos sync_log retirados: ${removed.count}`);
await prisma.$disconnect();
