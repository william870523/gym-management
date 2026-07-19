/**
 * Migración aditiva e idempotente del expediente de baja de entrenadores.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TRAINER_OFFBOARDING_CASE_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina TRAINER_OFFBOARDING_CASE_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS entrenador_baja_expediente (
      expediente_id VARCHAR(191) NOT NULL,
      id_entrenador VARCHAR(191) NOT NULL,
      abierto_clave VARCHAR(191) NULL,
      fecha_efectiva DATETIME(3) NOT NULL,
      estado VARCHAR(32) NOT NULL DEFAULT 'BORRADOR',
      motivo TEXT NOT NULL,
      decisiones_total INT NOT NULL DEFAULT 0,
      decisiones_pendientes INT NOT NULL DEFAULT 0,
      creado_por_user_id VARCHAR(191) NOT NULL,
      creado_por_nombre_snapshot VARCHAR(191) NOT NULL,
      creado_at DATETIME(3) NOT NULL,
      impacto_snapshot_json LONGTEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (expediente_id),
      UNIQUE KEY uq_ent_baja_abierta (abierto_clave),
      KEY idx_ent_baja_ent_estado (gym_id, id_entrenador, estado),
      KEY idx_ent_baja_fecha_estado (gym_id, fecha_efectiva, estado)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS entrenador_baja_decision (
      decision_id VARCHAR(191) NOT NULL,
      expediente_id VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      asignacion_origen_id VARCHAR(191) NULL,
      tipo VARCHAR(32) NOT NULL DEFAULT 'PENDIENTE',
      id_entrenador_destino VARCHAR(191) NULL,
      motivo TEXT NULL,
      socio_ci_snapshot VARCHAR(191) NOT NULL,
      socio_nombre_snapshot VARCHAR(191) NOT NULL,
      plan_nombre_snapshot VARCHAR(191) NOT NULL,
      membresia_estado_snapshot VARCHAR(32) NOT NULL,
      membresia_fecha_inicio_snapshot DATETIME(3) NOT NULL,
      membresia_fecha_fin_snapshot DATETIME(3) NOT NULL,
      origen_asignacion_snapshot VARCHAR(32) NOT NULL,
      decidida_por_user_id VARCHAR(191) NULL,
      decidida_por_nombre_snapshot VARCHAR(191) NULL,
      decidida_at DATETIME(3) NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (decision_id),
      UNIQUE KEY uq_ent_baja_dec_memb (expediente_id, membresia_id),
      KEY idx_ent_baja_dec_exp_tipo (gym_id, expediente_id, tipo),
      KEY idx_ent_baja_dec_memb (gym_id, membresia_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Migración remota de expedientes de baja lista.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
