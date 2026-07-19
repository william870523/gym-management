/**
 * Migración aditiva e idempotente del libro de Tesorería y cierre diario.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TREASURY_LEDGER_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina TREASURY_LEDGER_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tesoreria_movimiento (
      movimiento_id VARCHAR(191) PRIMARY KEY,
      clave_origen VARCHAR(191) NOT NULL,
      origen_tipo VARCHAR(64) NOT NULL,
      origen_id VARCHAR(191) NOT NULL,
      origen_detalle_id VARCHAR(191) NULL,
      direccion VARCHAR(16) NOT NULL,
      concepto VARCHAR(64) NOT NULL,
      cuenta_id VARCHAR(191) NULL,
      moneda_id VARCHAR(191) NOT NULL,
      tipo_pago_id VARCHAR(191) NULL,
      monto DECIMAL(18,2) NOT NULL,
      ocurrido_at DATETIME(3) NOT NULL,
      fecha_negocio DATETIME(3) NOT NULL,
      descripcion TEXT NULL,
      contramovimiento_de_id VARCHAR(191) NULL,
      requiere_revision BOOLEAN NOT NULL DEFAULT false,
      revision_motivo TEXT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      UNIQUE KEY uq_tes_mov_gym_origen (gym_id, clave_origen),
      KEY idx_tes_mov_gym_dia_cuenta (gym_id, fecha_negocio, cuenta_id),
      KEY idx_tes_mov_gym_moneda_fecha (gym_id, moneda_id, ocurrido_at),
      KEY idx_tes_mov_gym_origen (gym_id, origen_tipo, origen_id)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS tesoreria_cierre (
      cierre_id VARCHAR(191) PRIMARY KEY,
      operacion_id VARCHAR(191) NOT NULL,
      clave_cierre VARCHAR(191) NOT NULL,
      comprobante_numero VARCHAR(191) NOT NULL,
      fecha_negocio DATETIME(3) NOT NULL,
      cuenta_id VARCHAR(191) NOT NULL,
      moneda_id VARCHAR(191) NOT NULL,
      saldo_inicial DECIMAL(18,2) NOT NULL,
      total_entradas DECIMAL(18,2) NOT NULL,
      total_salidas DECIMAL(18,2) NOT NULL,
      saldo_esperado DECIMAL(18,2) NOT NULL,
      saldo_contado DECIMAL(18,2) NOT NULL,
      diferencia DECIMAL(18,2) NOT NULL,
      movimientos_cantidad INT NOT NULL,
      movimientos_hasta_at DATETIME(3) NULL,
      cerrado_por_user_id VARCHAR(191) NOT NULL,
      cerrado_por_nombre_snapshot VARCHAR(191) NOT NULL,
      cerrado_at DATETIME(3) NOT NULL,
      snapshot_json LONGTEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      UNIQUE KEY uq_tes_cierre_operacion (operacion_id),
      UNIQUE KEY uq_tes_cierre_clave (clave_cierre),
      UNIQUE KEY uq_tes_cierre_gym_comprobante (gym_id, comprobante_numero),
      KEY idx_tes_cierre_gym_dia (gym_id, fecha_negocio),
      KEY idx_tes_cierre_gym_cuenta_dia (gym_id, cuenta_id, fecha_negocio)
    )
  `);
  console.log("Migración remota del libro de Tesorería lista.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
