/**
 * Migración aditiva e idempotente de cierres mensuales de Tesorería.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TREASURY_MONTH_CLOSE_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina TREASURY_MONTH_CLOSE_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tesoreria_cierre_mensual (
      cierre_mensual_id VARCHAR(191) PRIMARY KEY,
      operacion_id VARCHAR(191) NOT NULL,
      reapertura_operacion_id VARCHAR(191) NULL,
      bloqueo_clave VARCHAR(191) NULL,
      mes VARCHAR(191) NOT NULL,
      fecha_desde DATETIME(3) NOT NULL,
      fecha_hasta_exclusiva DATETIME(3) NOT NULL,
      estado VARCHAR(191) NOT NULL,
      motivo_cierre TEXT NOT NULL,
      resumen_snapshot_json LONGTEXT NOT NULL,
      resumen_sha256 VARCHAR(191) NOT NULL,
      cerrado_por_user_id VARCHAR(191) NOT NULL,
      cerrado_por_nombre_snapshot VARCHAR(191) NOT NULL,
      cerrado_por_rol_snapshot VARCHAR(191) NOT NULL,
      cerrado_at DATETIME(3) NOT NULL,
      reapertura_motivo TEXT NULL,
      reabierto_por_user_id VARCHAR(191) NULL,
      reabierto_por_nombre_snapshot VARCHAR(191) NULL,
      reabierto_por_rol_snapshot VARCHAR(191) NULL,
      reabierto_at DATETIME(3) NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      UNIQUE KEY uq_tes_cierre_mes_operacion (operacion_id),
      UNIQUE KEY uq_tes_cierre_mes_reapertura (reapertura_operacion_id),
      UNIQUE KEY uq_tes_cierre_mes_bloqueo (bloqueo_clave),
      KEY idx_tes_cierre_mes_gym_periodo (gym_id, mes, cerrado_at),
      KEY idx_tes_cierre_mes_gym_estado (gym_id, estado, mes)
    )
  `);
  console.log("Migración remota de cierres mensuales de Tesorería lista.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
