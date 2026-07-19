/**
 * Migración aditiva e idempotente para la liquidación final de bajas.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TRAINER_FINAL_SETTLEMENT_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina TRAINER_FINAL_SETTLEMENT_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    ALTER TABLE entrenador_liquidacion
      ADD COLUMN IF NOT EXISTS tipo VARCHAR(32) NOT NULL DEFAULT 'ORDINARIA',
      ADD COLUMN IF NOT EXISTS expediente_id VARCHAR(191) NULL
  `);
  await prisma.$executeRawUnsafe(
    "CREATE INDEX IF NOT EXISTS idx_ent_liq_expediente_estado ON entrenador_liquidacion(gym_id, expediente_id, estado)",
  );
  await prisma.$executeRawUnsafe(`
    ALTER TABLE entrenador_baja_expediente
      ADD COLUMN IF NOT EXISTS cierre_operacion_id VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS cerrado_por_user_id VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS cerrado_por_nombre_snapshot VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS cerrado_at DATETIME(3) NULL,
      ADD COLUMN IF NOT EXISTS cierre_resumen_json LONGTEXT NULL
  `);
  await prisma.$executeRawUnsafe(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_ent_baja_cierre_op ON entrenador_baja_expediente(cierre_operacion_id)",
  );
  console.log("Migración remota de liquidación final de bajas lista.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
