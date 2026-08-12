import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.VOLUNTARY_CANCELLATION_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error("Defina VOLUNTARY_CANCELLATION_BACKUP_PATH con el dump MariaDB previo.");
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS membresia_cancelacion_reversion (
      reversion_id VARCHAR(191) NOT NULL,
      ajuste_financiero_id VARCHAR(191) NOT NULL,
      operacion_id VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      credito_id VARCHAR(191) NULL,
      motivo TEXT NOT NULL,
      estado_restaurado VARCHAR(32) NOT NULL,
      fecha_fin_restaurada DATE NOT NULL,
      registrada_por_user_id VARCHAR(191) NOT NULL,
      registrada_por_nombre_snapshot VARCHAR(191) NOT NULL,
      registrada_at DATETIME(3) NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (reversion_id),
      UNIQUE KEY uq_memb_cancel_rev_ajuste (ajuste_financiero_id),
      UNIQUE KEY uq_memb_cancel_rev_operacion (operacion_id),
      KEY idx_memb_cancel_rev_memb_fecha (gym_id, membresia_id, registrada_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Migración remota de cancelación voluntaria lista.");
}

try { await migrate(); } finally { await prisma.$disconnect(); }
