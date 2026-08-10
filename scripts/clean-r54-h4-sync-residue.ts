/**
 * Retira únicamente los 15 sync_log huérfanos publicados por tres corridas
 * del escenario H4 de trainer-change-routes.test.ts.
 *
 * Falla cerrado ante un manifiesto parcial, contenido distinto, filas H4 aún
 * existentes o backup ausente/no coincidente. Una segunda ejecución es no-op.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const IDS = [
  118189, 118190, 118191, 118192, 118193,
  118230, 118231, 118232, 118233, 118234,
  118271, 118272, 118273, 118274, 118275,
] as const;
const EXPECTED_HASH = "dc168b645d5e2fe4772e2d235023a180e7af6b4c4179d7c9467e670743676085";
const GYM_ID = "local-gym-001";
const DEVICE_ID = "WEB_ADMIN";
const MEMBERSHIP_ID = "e2e2e2e2-2222-4222-8222-h4h4h4h4h4h4";
const CLIENT_ID = "TCR000000H4";
const ASSIGNMENT_ID = `${MEMBERSHIP_ID}-asig-1`;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function validateBackup() {
  const backupArg = option("--backup");
  const expectedSha = option("--backup-sha")?.toUpperCase();
  if (!backupArg || !expectedSha) {
    throw new Error("Se requieren --backup <archivo> y --backup-sha <sha256>.");
  }
  const path = resolve(backupArg);
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size === 0) {
    throw new Error(`Backup ausente o vacío: ${path}`);
  }
  const actualSha = createHash("sha256")
    .update(new Uint8Array(await file.arrayBuffer()))
    .digest("hex")
    .toUpperCase();
  if (actualSha !== expectedSha) {
    throw new Error(`SHA del backup no coincide: esperado ${expectedSha}, observado ${actualSha}.`);
  }
  return { path, size: file.size, sha256: actualSha };
}

async function inspectBusinessRows() {
  const [cliente, membresia, asignaciones, avisos] = await Promise.all([
    prisma.cliente.count({ where: { ci: CLIENT_ID } }),
    prisma.membresiaCliente.count({ where: { membresia_id: MEMBERSHIP_ID } }),
    prisma.membresiaEntrenadorAsignacion.count({ where: { membresia_id: MEMBERSHIP_ID } }),
    prisma.avisoAdministracion.count({ where: { referencia_id: MEMBERSHIP_ID } }),
  ]);
  return { cliente, membresia, asignaciones, avisos };
}

async function main() {
  const backup = await validateBackup();
  const rows = await prisma.syncLog.findMany({
    where: { id: { in: [...IDS] } },
    select: {
      id: true,
      event_id: true,
      entidad: true,
      operacion: true,
      entidad_id: true,
      gym_id: true,
      device_id: true,
    },
    orderBy: { id: "asc" },
  });

  if (rows.length === 0) {
    console.log(JSON.stringify({ status: "NO_OP", backup, removed: 0 }, null, 2));
    return;
  }
  if (rows.length !== IDS.length || rows.some((row, index) => row.id !== IDS[index])) {
    throw new Error(`Manifiesto parcial o alterado: se esperaban ${IDS.length}, se observaron ${rows.length}.`);
  }

  const invalid = rows.filter((row) =>
    row.gym_id !== GYM_ID ||
    row.device_id !== DEVICE_ID ||
    row.operacion !== "UPDATE" ||
    !["membresia_entrenador_asignacion", "membresia_cliente", "cliente", "aviso_administracion"].includes(row.entidad) ||
    !(
      [MEMBERSHIP_ID, CLIENT_ID, ASSIGNMENT_ID].includes(row.entidad_id) ||
      row.entidad === "membresia_entrenador_asignacion" ||
      row.entidad === "aviso_administracion"
    )
  );
  if (invalid.length) {
    throw new Error(`El manifiesto contiene ${invalid.length} fila(s) que no corresponden a H4.`);
  }

  const hash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  if (hash !== EXPECTED_HASH) {
    throw new Error(`Hash del manifiesto distinto: esperado ${EXPECTED_HASH}, observado ${hash}.`);
  }

  const businessRows = await inspectBusinessRows();
  if (Object.values(businessRows).some((count) => count !== 0)) {
    throw new Error(`H4 aún conserva filas de negocio: ${JSON.stringify(businessRows)}.`);
  }

  console.log(JSON.stringify({ status: "VERIFIED", backup, ids: IDS, hash, businessRows }, null, 2));
  if (!process.argv.includes("--apply")) {
    console.log("Vista previa: no se modificó sync_log. Añada --apply para ejecutar.");
    return;
  }

  const result = await prisma.$transaction((tx) => tx.syncLog.deleteMany({ where: { id: { in: [...IDS] } } }));
  const remaining = await prisma.syncLog.count({ where: { id: { in: [...IDS] } } });
  if (result.count !== IDS.length || remaining !== 0) {
    throw new Error(`Saneamiento incompleto: retirados=${result.count}, restantes=${remaining}.`);
  }
  console.log(JSON.stringify({ status: "APPLIED", removed: result.count, remaining }, null, 2));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
