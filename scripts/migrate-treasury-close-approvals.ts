/**
 * Migración aditiva e idempotente de tolerancias y aprobaciones de arqueo.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TREASURY_CLOSE_APPROVAL_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina TREASURY_CLOSE_APPROVAL_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  // Las políticas con tolerancias por moneda superan con facilidad el
  // VARCHAR histórico de 191/255 caracteres. TEXT es una ampliación segura.
  await prisma.$executeRawUnsafe(`
    ALTER TABLE configuracion_sistema
      MODIFY COLUMN valor TEXT NOT NULL
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE tesoreria_cierre
      ADD COLUMN IF NOT EXISTS aprobacion_estado VARCHAR(32) NOT NULL DEFAULT 'NO_REQUERIDA',
      ADD COLUMN IF NOT EXISTS tolerancia_aplicada DECIMAL(18,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS solicitud_id VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS justificacion_diferencia TEXT NULL,
      ADD COLUMN IF NOT EXISTS aprobado_por_user_id VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS aprobado_por_nombre_snapshot VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS aprobado_por_rol_snapshot VARCHAR(80) NULL,
      ADD COLUMN IF NOT EXISTS aprobado_at DATETIME(3) NULL
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tesoreria_cierre_solicitud (
      solicitud_id VARCHAR(191) PRIMARY KEY,
      operacion_id VARCHAR(191) NOT NULL,
      decision_operacion_id VARCHAR(191) NULL,
      intencion_firma VARCHAR(191) NOT NULL,
      pendiente_clave VARCHAR(191) NULL,
      fecha_negocio DATETIME(3) NOT NULL,
      cuenta_id VARCHAR(191) NOT NULL,
      moneda_id VARCHAR(191) NOT NULL,
      saldo_inicial DECIMAL(18,2) NOT NULL,
      total_entradas DECIMAL(18,2) NOT NULL,
      total_salidas DECIMAL(18,2) NOT NULL,
      saldo_esperado DECIMAL(18,2) NOT NULL,
      saldo_contado DECIMAL(18,2) NOT NULL,
      diferencia DECIMAL(18,2) NOT NULL,
      tolerancia_aplicada DECIMAL(18,2) NOT NULL,
      movimientos_cantidad INT NOT NULL,
      movimientos_hasta_at DATETIME(3) NULL,
      movimiento_ids_json LONGTEXT NOT NULL,
      motivo TEXT NOT NULL,
      estado VARCHAR(32) NOT NULL,
      solicitada_por_user_id VARCHAR(191) NOT NULL,
      solicitada_por_nombre_snapshot VARCHAR(191) NOT NULL,
      solicitada_por_rol_snapshot VARCHAR(80) NOT NULL,
      solicitada_at DATETIME(3) NOT NULL,
      decidida_por_user_id VARCHAR(191) NULL,
      decidida_por_nombre_snapshot VARCHAR(191) NULL,
      decidida_por_rol_snapshot VARCHAR(80) NULL,
      decision_motivo TEXT NULL,
      decidida_at DATETIME(3) NULL,
      cierre_id VARCHAR(191) NULL,
      politica_snapshot_json LONGTEXT NOT NULL,
      snapshot_json LONGTEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      UNIQUE KEY uq_tes_cierre_sol_operacion (operacion_id),
      UNIQUE KEY uq_tes_cierre_sol_decision (decision_operacion_id),
      UNIQUE KEY uq_tes_cierre_sol_pendiente (pendiente_clave),
      UNIQUE KEY uq_tes_cierre_sol_gym_intencion (gym_id, intencion_firma),
      KEY idx_tes_cierre_sol_gym_estado (gym_id, estado, solicitada_at),
      KEY idx_tes_cierre_sol_gym_cuenta_dia (gym_id, cuenta_id, fecha_negocio)
    )
  `);
  console.log("Migración remota de aprobaciones de arqueo lista.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
