/**
 * R5.6 — cobrador autenticado por pago (docs/PAYMENT_COLLECTOR_ATTRIBUTION.md).
 *
 * Gemela de la migración local: mismos cuatro campos y mismos índices en
 * `pago_cliente` y `tesoreria_movimiento`. Anulables por la historia anterior
 * al corte, que no se backfillea; la obligatoriedad la impone la aplicación.
 *
 * Exige un dump MariaDB verificable creado antes de ejecutarla.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const COLUMNS = [
  "cobrado_por_user_id",
  "cobrado_por_nombre_snapshot",
  "cobrado_por_rol_snapshot",
  "cobrado_por_origen",
];

async function columnsOf(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    table,
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function indexExists(table: string, name: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM information_schema.STATISTICS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    table,
    name,
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function verify() {
  const pago = await columnsOf("pago_cliente");
  const movimiento = await columnsOf("tesoreria_movimiento");
  const faltan = [
    ...COLUMNS.filter((name) => !pago.has(name)).map((n) => `pago_cliente.${n}`),
    ...COLUMNS.filter((name) => !movimiento.has(name))
      .map((n) => `tesoreria_movimiento.${n}`),
  ];
  if (faltan.length) {
    throw new Error(`La migración no dejó el esquema esperado: ${faltan.join(", ")}`);
  }
  const rows = await prisma.$queryRawUnsafe<
    Array<{ total: bigint; sin_actor: bigint }>
  >(
    "SELECT COUNT(*) AS total, " +
      "SUM(CASE WHEN cobrado_por_user_id IS NULL THEN 1 ELSE 0 END) AS sin_actor " +
      "FROM pago_cliente WHERE is_deleted = false",
  );
  console.log(
    `Cobros vigentes: ${Number(rows[0]?.total ?? 0)} · sin atribuir ` +
      `(histórico): ${Number(rows[0]?.sin_actor ?? 0)}. No se backfillea ninguno.`,
  );
}

async function migrate() {
  const backupPath = process.env.PAYMENT_COLLECTOR_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina PAYMENT_COLLECTOR_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE pago_cliente
      ADD COLUMN IF NOT EXISTS cobrado_por_user_id VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS cobrado_por_nombre_snapshot VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS cobrado_por_rol_snapshot VARCHAR(80) NULL,
      ADD COLUMN IF NOT EXISTS cobrado_por_origen VARCHAR(32) NULL
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE tesoreria_movimiento
      ADD COLUMN IF NOT EXISTS cobrado_por_user_id VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS cobrado_por_nombre_snapshot VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS cobrado_por_rol_snapshot VARCHAR(80) NULL,
      ADD COLUMN IF NOT EXISTS cobrado_por_origen VARCHAR(32) NULL
  `);

  // MariaDB no acepta CREATE INDEX IF NOT EXISTS en todas las versiones en uso;
  // se comprueba antes para que la segunda ejecución sea un no-op limpio.
  if (!(await indexExists("pago_cliente", "idx_pago_cliente_gym_cobrador_fecha"))) {
    await prisma.$executeRawUnsafe(
      "CREATE INDEX idx_pago_cliente_gym_cobrador_fecha " +
        "ON pago_cliente(gym_id, cobrado_por_user_id, fecha)",
    );
  }
  if (!(await indexExists("tesoreria_movimiento", "idx_tes_mov_gym_dia_cobrador"))) {
    await prisma.$executeRawUnsafe(
      "CREATE INDEX idx_tes_mov_gym_dia_cobrador " +
        "ON tesoreria_movimiento(gym_id, fecha_negocio, cobrado_por_user_id)",
    );
  }

  await verify();
  console.log("Migración remota del cobrador por pago lista.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
