/**
 * Migración aditiva e idempotente de la ejecución de bajas de entrenador.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TRAINER_OFFBOARDING_EXECUTION_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina TRAINER_OFFBOARDING_EXECUTION_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    ALTER TABLE entrenador_baja_expediente
      ADD COLUMN IF NOT EXISTS ejecucion_operacion_id VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS ejecutado_por_user_id VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS ejecutado_por_nombre_snapshot VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS ejecutado_at DATETIME(3) NULL,
      ADD COLUMN IF NOT EXISTS ejecucion_resumen_json LONGTEXT NULL
  `);
  await prisma.$executeRawUnsafe(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_ent_baja_ejec_op ON entrenador_baja_expediente(ejecucion_operacion_id)",
  );
  await prisma.$executeRawUnsafe(`
    ALTER TABLE entrenador_baja_decision
      ADD COLUMN IF NOT EXISTS estado_ejecucion VARCHAR(32) NOT NULL DEFAULT 'PENDIENTE',
      ADD COLUMN IF NOT EXISTS asignacion_destino_id VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS ejecutada_at DATETIME(3) NULL,
      ADD COLUMN IF NOT EXISTS ejecucion_resultado_json LONGTEXT NULL
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS entrenador_baja_comision_ajuste (
      ajuste_id VARCHAR(191) NOT NULL,
      expediente_id VARCHAR(191) NOT NULL,
      decision_id VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      devengo_id VARCHAR(191) NOT NULL,
      cuota_id VARCHAR(191) NOT NULL,
      tipo VARCHAR(32) NOT NULL,
      id_entrenador_origen VARCHAR(191) NOT NULL,
      id_entrenador_destino VARCHAR(191) NULL,
      moneda_id VARCHAR(191) NOT NULL,
      monto DOUBLE NOT NULL,
      periodo_inicio DATETIME(3) NOT NULL,
      periodo_fin DATETIME(3) NOT NULL,
      estado_anterior VARCHAR(32) NOT NULL,
      estado_resultante VARCHAR(32) NOT NULL,
      registrado_por_user_id VARCHAR(191) NOT NULL,
      registrado_por_nombre_snapshot VARCHAR(191) NOT NULL,
      registrado_at DATETIME(3) NOT NULL,
      resumen_json LONGTEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (ajuste_id),
      UNIQUE KEY uq_ent_baja_aj_exp_cuota (expediente_id, cuota_id),
      KEY idx_ent_baja_aj_exp_fecha (gym_id, expediente_id, registrado_at),
      KEY idx_ent_baja_aj_origen_tipo (gym_id, id_entrenador_origen, tipo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Migración remota de ejecución de bajas lista.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
