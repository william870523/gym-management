/**
 * Migración aditiva e idempotente del seguimiento de retención.
 * Requiere un dump externo verificado antes de ejecutarse.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.RETENTION_MANAGEMENT_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina RETENTION_MANAGEMENT_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS retencion_gestion (
      gestion_id VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      ci VARCHAR(191) NOT NULL,
      resultado VARCHAR(32) NOT NULL,
      canal VARCHAR(32) NOT NULL,
      nota TEXT NULL,
      promesa_fecha DATETIME(3) NULL,
      proxima_gestion_fecha DATETIME(3) NULL,
      registrada_por_user_id VARCHAR(191) NOT NULL,
      registrada_por_nombre_snapshot VARCHAR(191) NOT NULL,
      registrada_at DATETIME(3) NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (gestion_id),
      KEY idx_ret_gest_gym_ci_fecha (gym_id, ci, registrada_at),
      KEY idx_ret_gest_gym_proxima_result (gym_id, proxima_gestion_fecha, resultado),
      KEY idx_ret_gest_memb_fecha (membresia_id, registrada_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const count = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM retencion_gestion",
  );
  console.log(`Migración remota de gestiones lista; registros: ${Number(count[0]?.total ?? 0)}.`);
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
