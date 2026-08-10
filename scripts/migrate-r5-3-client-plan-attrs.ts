/**
 * Migración aditiva e idempotente R5.3 (MariaDB):
 *  - `cliente.categoria` (NUEVO|VIEJO) para el descuento por categoría.
 *  - `planes_pago.codigo` (PMV, TCN...) — código corto de recepción.
 *  - `planes_pago.precio_viejo_excepcion` — precio fijo cliente VIEJO (anula %).
 *  - `pago_cliente.precio_lista_snapshot`, `descuento_pct_snapshot`,
 *    `descuento_monto_snapshot` — congelan el descuento al cobrar (igual que
 *    `tipo_cambio_id` congela el recargo R5.1).
 *
 * Exige un dump MariaDB verificable creado antes de ejecutarla. Clon del patrón R5.1.
 */
import { existsSync } from "fs";
import { prisma } from "../src/infrastructure/db/prismaClient";

type Columns = Set<string>;

async function tableColumns(table: string): Promise<Columns> {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`,
  );
  return new Set(rows.map((r) => r.COLUMN_NAME));
}

const ADDITIONS: Array<{ table: string; column: string; ddl: string }> = [
  { table: "cliente", column: "categoria", ddl: "ADD COLUMN categoria VARCHAR(191) NOT NULL DEFAULT 'NUEVO'" },
  { table: "planes_pago", column: "codigo", ddl: "ADD COLUMN codigo VARCHAR(191) NULL" },
  { table: "planes_pago", column: "precio_viejo_excepcion", ddl: "ADD COLUMN precio_viejo_excepcion DOUBLE NULL" },
  { table: "pago_cliente", column: "precio_lista_snapshot", ddl: "ADD COLUMN precio_lista_snapshot DOUBLE NULL" },
  { table: "pago_cliente", column: "descuento_pct_snapshot", ddl: "ADD COLUMN descuento_pct_snapshot VARCHAR(191) NULL" },
  { table: "pago_cliente", column: "descuento_monto_snapshot", ddl: "ADD COLUMN descuento_monto_snapshot DOUBLE NULL" },
  { table: "pago_cliente", column: "categoria_cliente_snapshot", ddl: "ADD COLUMN categoria_cliente_snapshot VARCHAR(191) NULL" },
  { table: "pago_cliente", column: "plan_codigo_snapshot", ddl: "ADD COLUMN plan_codigo_snapshot VARCHAR(191) NULL" },
  { table: "pago_cliente", column: "cuota_sufijo_snapshot", ddl: "ADD COLUMN cuota_sufijo_snapshot VARCHAR(191) NULL" },
];

async function migrate() {
  const backupPath = process.env.R5_3_BACKUP_PATH;
  if (!backupPath || !existsSync(backupPath)) {
    throw new Error(
      "Defina R5_3_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }

  const snapshots = new Map<string, Columns>();
  for (const { table } of ADDITIONS) {
    if (!snapshots.has(table)) snapshots.set(table, await tableColumns(table));
  }
  const pending = ADDITIONS.filter(
    (a) => !snapshots.get(a.table)!.has(a.column),
  );
  if (pending.length === 0) {
    console.log("Migración remota ya aplicada: columnas R5.3 existen.");
    return;
  }
  // ALTER TABLE múltiple en una sola sentencia por tabla.
  const byTable = new Map<string, string[]>();
  for (const { table, ddl } of pending) {
    if (!byTable.has(table)) byTable.set(table, []);
    byTable.get(table)!.push(ddl);
  }
  for (const [table, ddls] of byTable) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ${ddls.join(", ")}`);
  }
  console.log("Migración remota lista: columnas R5.3 verificadas.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
