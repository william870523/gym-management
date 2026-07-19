/**
 * Migración aditiva e idempotente R5.1: columna `recargos_json` en
 * `tipo_cambio` (recargo porcentual por método de pago; ganancia del
 * gimnasio). Exige un dump MariaDB verificable creado antes de ejecutarla.
 */
import { existsSync } from "fs";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.EXCHANGE_SURCHARGE_BACKUP_PATH;
  if (!backupPath || !existsSync(backupPath)) {
    throw new Error(
      "Defina EXCHANGE_SURCHARGE_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }

  const columns = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tipo_cambio'
       AND COLUMN_NAME = 'recargos_json'`,
  );
  if (columns.length > 0) {
    console.log("Migración remota ya aplicada: recargos_json existe.");
    return;
  }
  await prisma.$executeRawUnsafe(
    "ALTER TABLE tipo_cambio ADD COLUMN recargos_json TEXT NULL",
  );
  console.log("Migración remota lista: tipo_cambio.recargos_json creada.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
