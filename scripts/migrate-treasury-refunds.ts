/** Migración aditiva e idempotente de la bandeja de reembolsos. */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TREASURY_REFUNDS_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error("Defina TREASURY_REFUNDS_BACKUP_PATH con el dump MariaDB previo.");
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS cliente_reembolso_tesoreria (
      reembolso_id VARCHAR(191) NOT NULL,
      ajuste_financiero_id VARCHAR(191) NOT NULL,
      operacion_id VARCHAR(191) NOT NULL,
      comprobante_numero VARCHAR(191) NOT NULL,
      ci VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      moneda_id VARCHAR(191) NOT NULL,
      monto DECIMAL(18,2) NOT NULL,
      estado VARCHAR(32) NOT NULL,
      cuenta_id VARCHAR(191) NULL,
      tipo_pago_id VARCHAR(191) NULL,
      motivo TEXT NOT NULL,
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
      PRIMARY KEY (reembolso_id),
      UNIQUE KEY uq_cli_reemb_operacion (operacion_id),
      UNIQUE KEY uq_cli_reemb_gym_comprobante (gym_id, comprobante_numero),
      KEY idx_cli_reemb_gym_estado_fecha (gym_id, estado, registrada_at),
      KEY idx_cli_reemb_ajuste (gym_id, ajuste_financiero_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS cliente_reembolso_reversion (
      reversion_id VARCHAR(191) NOT NULL,
      reembolso_id VARCHAR(191) NOT NULL,
      operacion_id VARCHAR(191) NOT NULL,
      motivo TEXT NOT NULL,
      monto DECIMAL(18,2) NOT NULL,
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
      UNIQUE KEY uq_cli_reemb_rev_reembolso (reembolso_id),
      UNIQUE KEY uq_cli_reemb_rev_operacion (operacion_id),
      KEY idx_cli_reemb_rev_gym_fecha (gym_id, registrada_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Migración remota de reembolsos de Tesorería lista.");
}

try { await migrate(); } finally { await prisma.$disconnect(); }
