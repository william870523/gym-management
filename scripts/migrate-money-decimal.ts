/**
 * MONEY-01 — gemela MariaDB de la migración monetaria exacta.
 * Conserva *_float_legacy y exige un dump verificable previo.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

type Field = {
  table: string;
  column: string;
  precision: number;
  scale: number;
  nullable?: boolean;
};
const FIELDS: Field[] = [
  { table: "tipo_cambio", column: "exchange_rate", precision: 24, scale: 8 },
  { table: "planes_pago", column: "importe_plan_pago", precision: 18, scale: 2 },
  { table: "planes_pago", column: "comision_entrenador_valor", precision: 18, scale: 6, nullable: true },
  { table: "planes_pago", column: "precio_viejo_excepcion", precision: 18, scale: 2, nullable: true },
  { table: "pago_reversion", column: "monto_total", precision: 18, scale: 2 },
  { table: "entrenador_comision_regla", column: "valor_calculo", precision: 18, scale: 6 },
  { table: "entrenador_comision_devengo", column: "monto_base", precision: 18, scale: 2 },
  { table: "entrenador_comision_devengo", column: "valor_calculo", precision: 18, scale: 6 },
  { table: "entrenador_comision_devengo", column: "monto_total", precision: 18, scale: 2 },
  { table: "entrenador_baja_comision_ajuste", column: "monto", precision: 18, scale: 2 },
  { table: "entrenador_comision_cuota", column: "monto", precision: 18, scale: 2 },
  { table: "pago_cliente", column: "monto_total", precision: 18, scale: 2 },
  { table: "pago_cliente", column: "precio_lista_snapshot", precision: 18, scale: 2, nullable: true },
  { table: "pago_cliente", column: "descuento_monto_snapshot", precision: 18, scale: 2, nullable: true },
  { table: "detalle_pago", column: "cantidad", precision: 18, scale: 2 },
];

async function columnsOf(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    table,
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function migrateField(field: Field) {
  const legacy = `${field.column}_float_legacy`;
  const columns = await columnsOf(field.table);
  const added = !columns.has(legacy);
  if (added) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${field.table} ADD COLUMN ${legacy} DOUBLE NULL`,
    );
  }
  await prisma.$executeRawUnsafe(
    `UPDATE ${field.table} SET ${legacy} = ${field.column} ` +
      `WHERE ${legacy} IS NULL AND ${field.column} IS NOT NULL`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE ${field.table} MODIFY COLUMN ${field.column} ` +
      `DECIMAL(${field.precision}, ${field.scale}) ${field.nullable ? "NULL" : "NOT NULL"}`,
  );
  const [row] = await prisma.$queryRawUnsafe<Array<{
    DATA_TYPE: string;
    NUMERIC_PRECISION: bigint;
    NUMERIC_SCALE: bigint;
  }>>(
    "SELECT DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE " +
      "FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() " +
      "AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    field.table,
    field.column,
  );
  if (
    row?.DATA_TYPE !== "decimal" ||
    Number(row.NUMERIC_PRECISION) !== field.precision ||
    Number(row.NUMERIC_SCALE) !== field.scale
  ) {
    throw new Error(`Tipo inesperado en ${field.table}.${field.column}`);
  }
  console.log(
    `${field.table}.${field.column}: ${added ? "respaldo añadido" : "respaldo existente"} ` +
      `· DECIMAL(${field.precision},${field.scale})`,
  );
}

const backupPath = process.env.MONEY_DECIMAL_BACKUP_PATH;
if (!backupPath || !existsSync(resolve(backupPath))) {
  throw new Error(
    "Defina MONEY_DECIMAL_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
  );
}

try {
  for (const field of FIELDS) await migrateField(field);
  console.log(`MONEY-01 remoto: ${FIELDS.length} campos DECIMAL; 0 columnas destructivas.`);
} finally {
  await prisma.$disconnect();
}

