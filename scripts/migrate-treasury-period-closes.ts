/** R5.7 — migración MariaDB aditiva; exige dump previo verificable. */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const target = process.env.DATABASE_URL ?? "";
  if (!/^mysql:\/\//.test(target)) throw new Error("R5.7 remota exige una DATABASE_URL MariaDB explícita.");
  const backup = process.env.TREASURY_PERIOD_BACKUP_PATH;
  if (!backup || !existsSync(resolve(backup)) || statSync(resolve(backup)).size === 0) {
    throw new Error("Defina TREASURY_PERIOD_BACKUP_PATH con un dump MariaDB previo y no vacío.");
  }
  console.log(`Respaldo MariaDB verificado: ${resolve(backup)} (${statSync(resolve(backup)).size} bytes)`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tesoreria_cierre_periodo (
      cierre_periodo_id VARCHAR(191) PRIMARY KEY,
      operacion_id VARCHAR(191) NOT NULL,
      clave_periodo_activa VARCHAR(191) NULL,
      tipo_periodo VARCHAR(191) NOT NULL,
      fecha_inicio DATETIME(3) NOT NULL,
      fecha_fin_exclusiva DATETIME(3) NOT NULL,
      ciclo_numero INT NOT NULL,
      estado VARCHAR(191) NOT NULL,
      motivo_cierre TEXT NOT NULL,
      cerrado_por_user_id VARCHAR(191) NOT NULL,
      cerrado_por_nombre_snapshot VARCHAR(191) NOT NULL,
      cerrado_por_rol_snapshot VARCHAR(191) NOT NULL,
      cerrado_at DATETIME(3) NOT NULL,
      reapertura_operacion_id VARCHAR(191) NULL,
      reapertura_motivo TEXT NULL,
      reabierto_por_user_id VARCHAR(191) NULL,
      reabierto_por_nombre_snapshot VARCHAR(191) NULL,
      reabierto_por_rol_snapshot VARCHAR(191) NULL,
      reabierto_at DATETIME(3) NULL,
      snapshot_version INT NOT NULL DEFAULT 1,
      snapshot_json LONGTEXT NOT NULL,
      snapshot_sha256 VARCHAR(191) NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      UNIQUE KEY uq_tes_cierre_periodo_operacion (operacion_id),
      UNIQUE KEY uq_tes_cierre_periodo_activa (clave_periodo_activa),
      UNIQUE KEY uq_tes_cierre_periodo_reapertura (reapertura_operacion_id),
      KEY idx_tes_cierre_periodo_gym_rango (gym_id, fecha_inicio, fecha_fin_exclusiva),
      KEY idx_tes_cierre_periodo_gym_estado (gym_id, estado, cerrado_at)
    )
  `);
  const columns = await prisma.$queryRawUnsafe<any[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tesoreria_cierre_periodo'");
  if (columns.length !== 29) throw new Error(`Esquema R5.7 incompleto: ${columns.length}/29 columnas.`);
  console.log("Migración remota R5.7 verificada (29 columnas; índices idempotentes).");
}
try { await migrate(); } finally { await prisma.$disconnect(); }
