/**
 * Gemela MariaDB de la migración de tipos documentales.
 *
 * Exige un dump previo y no clasifica automáticamente documentos históricos.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const TABLES = ["cliente", "entrenadores"] as const;

async function columnsOf(table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    table,
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function migrate() {
  const backupPath = process.env.DOCUMENT_TYPE_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina DOCUMENT_TYPE_BACKUP_PATH con el dump MariaDB previo.",
    );
  }

  for (const table of TABLES) {
    const columns = await columnsOf(table);
    if (!columns.has("tipo_documento")) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${table} ADD COLUMN tipo_documento VARCHAR(32) ` +
          `NOT NULL DEFAULT 'DESCONOCIDO'`,
      );
      console.log(`${table}.tipo_documento añadido.`);
    } else {
      console.log(`${table}.tipo_documento ya existía.`);
    }
  }

  for (const table of TABLES) {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ tipo: string; total: bigint }>
    >(
      `SELECT tipo_documento AS tipo, COUNT(*) AS total ` +
        `FROM ${table} GROUP BY tipo_documento ORDER BY tipo_documento`,
    );
    console.log(
      `${table}: ${JSON.stringify(
        rows.map((row) => ({ tipo: row.tipo, total: Number(row.total) })),
      )}`,
    );
  }
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
