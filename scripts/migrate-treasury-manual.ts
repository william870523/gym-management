/**
 * Migración aditiva e idempotente de operaciones manuales de Tesorería.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TREASURY_MANUAL_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina TREASURY_MANUAL_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tesoreria_operacion_manual (
      operacion_manual_id VARCHAR(191) PRIMARY KEY,
      operacion_id VARCHAR(191) NOT NULL,
      intencion_firma VARCHAR(191) NOT NULL,
      comprobante_numero VARCHAR(191) NOT NULL,
      tipo VARCHAR(32) NOT NULL,
      concepto VARCHAR(191) NOT NULL,
      descripcion TEXT NULL,
      evidencia_referencia TEXT NOT NULL,
      cuenta_origen_id VARCHAR(191) NULL,
      cuenta_destino_id VARCHAR(191) NULL,
      tipo_pago_origen_id VARCHAR(191) NULL,
      tipo_pago_destino_id VARCHAR(191) NULL,
      moneda_id VARCHAR(191) NOT NULL,
      monto DECIMAL(18,2) NOT NULL,
      fecha_negocio DATETIME(3) NOT NULL,
      registrada_por_user_id VARCHAR(191) NOT NULL,
      registrada_por_nombre_snapshot VARCHAR(191) NOT NULL,
      registrada_at DATETIME(3) NOT NULL,
      resumen_json LONGTEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      UNIQUE KEY uq_tes_op_manual_operacion (operacion_id),
      UNIQUE KEY uq_tes_op_manual_gym_comprobante (gym_id, comprobante_numero),
      KEY idx_tes_op_manual_gym_dia (gym_id, fecha_negocio),
      KEY idx_tes_op_manual_gym_tipo_fecha (gym_id, tipo, registrada_at)
    )
  `);
  console.log("Migración remota de operaciones manuales de Tesorería lista.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
