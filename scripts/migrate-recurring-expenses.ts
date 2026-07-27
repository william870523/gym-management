/**
 * Migración aditiva e idempotente de gastos recurrentes (R4.7).
 *
 * Crea `gasto_recurrente` (la plantilla) y añade `gasto_gobernado.recurrente_id`
 * con su índice único por (recurrente_id, mes de pertenencia), que es lo que
 * hace idempotente la generación mensual. No modifica ni borra gasto alguno ya
 * registrado: los gastos existentes quedan con `recurrente_id` nulo, es decir,
 * manuales.
 *
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function columnExists(table: string, column: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    `SELECT COUNT(*) AS total FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    table,
    column,
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function indexExists(table: string, index: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    `SELECT COUNT(*) AS total FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    table,
    index,
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function migrate() {
  const backupPath = process.env.RECURRING_EXPENSE_BACKUP_PATH;
  if (!backupPath || !existsSync(backupPath)) {
    throw new Error(
      "Defina RECURRING_EXPENSE_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  console.log(`Respaldo verificado: ${backupPath}`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS gasto_recurrente (
      recurrente_id VARCHAR(191) NOT NULL,
      gym_id VARCHAR(191) NOT NULL,
      categoria_id VARCHAR(191) NOT NULL,
      proveedor_id VARCHAR(191) NULL,
      moneda_id VARCHAR(191) NOT NULL,
      descripcion VARCHAR(191) NOT NULL,
      monto DECIMAL(65, 30) NOT NULL,
      dia_programado INT NOT NULL DEFAULT 1,
      mes_inicio VARCHAR(7) NOT NULL,
      mes_fin VARCHAR(7) NULL,
      activo BOOLEAN NOT NULL DEFAULT true,
      notas VARCHAR(191) NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (recurrente_id),
      KEY idx_gasto_recurrente_activo (gym_id, activo),
      KEY idx_gasto_recurrente_categoria (gym_id, categoria_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (await columnExists("gasto_gobernado", "recurrente_id")) {
    console.log("La columna gasto_gobernado.recurrente_id ya existía.");
  } else {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE gasto_gobernado ADD COLUMN recurrente_id VARCHAR(191) NULL AFTER fecha_programada",
    );
    console.log("Columna gasto_gobernado.recurrente_id añadida (nula = gasto manual).");
  }

  // En MariaDB un índice único también ignora las filas con NULL, así que los
  // gastos manuales no compiten entre sí por el mismo mes.
  if (await indexExists("gasto_gobernado", "uq_gasto_recurrente_mes")) {
    console.log("El índice uq_gasto_recurrente_mes ya existía.");
  } else {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE gasto_gobernado ADD UNIQUE KEY uq_gasto_recurrente_mes (recurrente_id, periodo_pertenencia_mes)",
    );
    console.log("Índice único uq_gasto_recurrente_mes creado.");
  }

  const templates = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    "SELECT COUNT(*) AS total FROM gasto_recurrente",
  );
  const expenses = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    "SELECT COUNT(*) AS total FROM gasto_gobernado WHERE recurrente_id IS NOT NULL",
  );
  console.log(
    `Migración lista: ${Number(templates[0]?.total ?? 0)} plantilla(s), ` +
      `${Number(expenses[0]?.total ?? 0)} gasto(s) generados por plantilla.`,
  );
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
