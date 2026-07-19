/**
 * Migración aditiva e idempotente de aplicaciones de obligaciones fijas.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TRAINER_SETTLEMENT_FIXED_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina TRAINER_SETTLEMENT_FIXED_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS entrenador_liquidacion_obligacion_aplicacion (
      aplicacion_id VARCHAR(191) NOT NULL,
      liquidacion_id VARCHAR(191) NOT NULL,
      obligacion_id VARCHAR(191) NOT NULL,
      monto_aplicado DECIMAL(18,2) NOT NULL,
      estado VARCHAR(32) NOT NULL DEFAULT 'APLICADA',
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (aplicacion_id),
      UNIQUE KEY uq_ent_liq_obl_app_obligacion (liquidacion_id, obligacion_id),
      KEY idx_ent_liq_obl_app_obl_estado (gym_id, obligacion_id, estado),
      KEY idx_ent_liq_obl_app_liquidacion (gym_id, liquidacion_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const count = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM entrenador_liquidacion_obligacion_aplicacion",
  );
  console.log(
    `Migración remota lista; aplicaciones fijas: ${Number(count[0]?.total ?? 0)}.`,
  );
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
