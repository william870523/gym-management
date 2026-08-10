/** R5.1 — gemela MariaDB del snapshot de recargo por método. */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const COLUMNS = [
  "recargo_metodo_base",
  "recargo_metodo_pct",
  "recargo_metodo_importe",
  "recargo_metodo_total",
  "recargo_metodo_politica",
  "recargo_metodo_tasa_version",
];

async function columns() {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    "detalle_pago",
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function migrate() {
  const before = await columns();
  const missing = COLUMNS.filter((name) => !before.has(name));
  if (missing.length) {
    const backupPath = process.env.PAYMENT_METHOD_SURCHARGE_BACKUP_PATH;
    if (!backupPath || !existsSync(resolve(backupPath))) {
      throw new Error(
        "Defina PAYMENT_METHOD_SURCHARGE_BACKUP_PATH con el dump MariaDB previo.",
      );
    }
    await prisma.$executeRawUnsafe(`
      ALTER TABLE detalle_pago
        ADD COLUMN IF NOT EXISTS recargo_metodo_base VARCHAR(191) NULL,
        ADD COLUMN IF NOT EXISTS recargo_metodo_pct VARCHAR(191) NULL,
        ADD COLUMN IF NOT EXISTS recargo_metodo_importe VARCHAR(191) NULL,
        ADD COLUMN IF NOT EXISTS recargo_metodo_total VARCHAR(191) NULL,
        ADD COLUMN IF NOT EXISTS recargo_metodo_politica VARCHAR(191) NULL,
        ADD COLUMN IF NOT EXISTS recargo_metodo_tasa_version INT NULL
    `);
  }
  const after = await columns();
  const absent = COLUMNS.filter((name) => !after.has(name));
  if (absent.length) throw new Error(`Faltan columnas: ${absent.join(", ")}`);
  console.log(`R5.1 remoto: ${missing.length} columna(s) añadida(s); históricos sin alterar.`);
}

try { await migrate(); } finally { await prisma.$disconnect(); }
