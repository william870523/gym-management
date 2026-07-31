/**
 * Unidad 09 — actor congelado en gastos y cierres (paridad con R5.6).
 *
 * Gemela de la migración local: mismas siete columnas en las mismas tres
 * tablas. El motivo completo está en la cabecera de
 * `gym-local-api/scripts/migrate-frozen-actor.ts`; en corto: quién hizo algo
 * viaja congelado dentro del evento —identificador, nombre, rol y origen—
 * porque una cuenta `LOCAL_USER` puede no tener nunca fila en MariaDB y aun así
 * ser quien registró el gasto o firmó el cierre.
 *
 * Anulables por la historia anterior al corte, que no se backfillea; la
 * obligatoriedad la impone la aplicación.
 *
 * Exige un dump MariaDB verificable creado antes de ejecutarla.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const TABLE_COLUMNS: Array<[string, Array<[string, string]>]> = [
  [
    "gasto_gobernado",
    [
      ["registrada_por_nombre_snapshot", "VARCHAR(191) NULL"],
      ["registrada_por_rol_snapshot", "VARCHAR(80) NULL"],
      ["registrada_por_origen", "VARCHAR(32) NULL"],
    ],
  ],
  [
    "tesoreria_cierre_mensual",
    [
      ["cerrado_por_origen", "VARCHAR(32) NULL"],
      ["reabierto_por_origen", "VARCHAR(32) NULL"],
    ],
  ],
  [
    "tesoreria_cierre_solicitud",
    [
      ["solicitada_por_origen", "VARCHAR(32) NULL"],
      ["decidida_por_origen", "VARCHAR(32) NULL"],
    ],
  ],
];

async function columnsOf(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    table,
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function verify() {
  const faltan: string[] = [];
  for (const [table, columns] of TABLE_COLUMNS) {
    const existing = await columnsOf(table);
    for (const [name] of columns) {
      if (!existing.has(name)) faltan.push(`${table}.${name}`);
    }
  }
  if (faltan.length) {
    throw new Error(
      `La migración no dejó el esquema esperado: ${faltan.join(", ")}`,
    );
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{ total: bigint; sin_origen: bigint }>
  >(
    "SELECT COUNT(*) AS total, " +
      "SUM(CASE WHEN registrada_por_origen IS NULL THEN 1 ELSE 0 END) AS sin_origen " +
      "FROM gasto_gobernado WHERE is_deleted = false",
  );
  console.log(
    `Gastos vigentes: ${Number(rows[0]?.total ?? 0)} · sin origen de actor ` +
      `(histórico): ${Number(rows[0]?.sin_origen ?? 0)}. No se backfillea ninguno.`,
  );
}

async function migrate() {
  const backupPath = process.env.FROZEN_ACTOR_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina FROZEN_ACTOR_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }

  for (const [table, columns] of TABLE_COLUMNS) {
    const additions = columns
      .map(([name, type]) => `ADD COLUMN IF NOT EXISTS ${name} ${type}`)
      .join(",\n      ");
    await prisma.$executeRawUnsafe(`
    ALTER TABLE ${table}
      ${additions}
  `);
    console.log(`${table}: ${columns.length} columna(s) aseguradas.`);
  }

  await verify();
  console.log("Migración remota del actor congelado lista.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
