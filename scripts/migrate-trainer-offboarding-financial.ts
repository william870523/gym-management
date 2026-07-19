/** Migración aditiva e idempotente del ajuste financiero en bajas. */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TRAINER_OFFBOARDING_FINANCIAL_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error("Defina TRAINER_OFFBOARDING_FINANCIAL_BACKUP_PATH con el dump MariaDB previo.");
  }
  await prisma.$executeRawUnsafe(`
    ALTER TABLE entrenador_comision_devengo
      ADD COLUMN IF NOT EXISTS membresia_id VARCHAR(191) NULL,
      ADD COLUMN IF NOT EXISTS fuente_tipo VARCHAR(32) NOT NULL DEFAULT 'PAGO_CLIENTE',
      ADD COLUMN IF NOT EXISTS fuente_id VARCHAR(191) NULL
  `);
  await prisma.$executeRawUnsafe("UPDATE entrenador_comision_devengo SET fuente_id = pago_cliente_id WHERE fuente_id IS NULL");
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS idx_ent_com_dev_memb_estado ON entrenador_comision_devengo(membresia_id, estado)");
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS idx_ent_com_dev_fuente ON entrenador_comision_devengo(fuente_tipo, fuente_id)");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS membresia_ajuste_financiero (
      ajuste_financiero_id VARCHAR(191) NOT NULL,
      operacion_id VARCHAR(191) NOT NULL,
      expediente_id VARCHAR(191) NOT NULL,
      decision_id VARCHAR(191) NOT NULL,
      membresia_origen_id VARCHAR(191) NOT NULL,
      membresia_destino_id VARCHAR(191) NULL,
      tipo VARCHAR(32) NOT NULL,
      estado VARCHAR(32) NOT NULL,
      plan_destino_id VARCHAR(191) NULL,
      id_entrenador_destino VARCHAR(191) NULL,
      moneda_id VARCHAR(191) NOT NULL,
      precio_origen DECIMAL(18,2) NOT NULL,
      importe_pagado_origen DECIMAL(18,2) NOT NULL,
      valor_no_consumido DECIMAL(18,2) NOT NULL,
      precio_destino DECIMAL(18,2) NULL,
      credito_aplicado DECIMAL(18,2) NOT NULL DEFAULT 0,
      importe_pendiente DECIMAL(18,2) NOT NULL DEFAULT 0,
      saldo_credito_generado DECIMAL(18,2) NOT NULL DEFAULT 0,
      importe_reembolso DECIMAL(18,2) NOT NULL DEFAULT 0,
      fecha_efectiva DATETIME(3) NOT NULL,
      motivo TEXT NOT NULL,
      formula_snapshot_json LONGTEXT NOT NULL,
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
      PRIMARY KEY (ajuste_financiero_id),
      UNIQUE KEY uq_memb_aj_fin_operacion (operacion_id),
      UNIQUE KEY uq_memb_aj_fin_decision (decision_id),
      KEY idx_memb_aj_fin_exp_estado (gym_id, expediente_id, estado),
      KEY idx_memb_aj_fin_memb (gym_id, membresia_origen_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS cliente_credito (
      credito_id VARCHAR(191) NOT NULL,
      ajuste_financiero_id VARCHAR(191) NOT NULL,
      ci VARCHAR(191) NOT NULL,
      moneda_id VARCHAR(191) NOT NULL,
      monto_original DECIMAL(18,2) NOT NULL,
      saldo DECIMAL(18,2) NOT NULL,
      estado VARCHAR(32) NOT NULL DEFAULT 'DISPONIBLE',
      motivo TEXT NOT NULL,
      generado_por_user_id VARCHAR(191) NOT NULL,
      generado_por_nombre_snapshot VARCHAR(191) NOT NULL,
      generado_at DATETIME(3) NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (credito_id),
      UNIQUE KEY uq_cli_cred_ajuste (ajuste_financiero_id),
      KEY idx_cli_cred_disponible (gym_id, ci, moneda_id, estado)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS credito_membresia_aplicacion (
      aplicacion_id VARCHAR(191) NOT NULL,
      credito_id VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      moneda_id VARCHAR(191) NOT NULL,
      monto_aplicado DECIMAL(18,2) NOT NULL,
      aplicada_at DATETIME(3) NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (aplicacion_id),
      UNIQUE KEY uq_cred_memb_aplicacion (credito_id, membresia_id),
      KEY idx_cred_memb_memb (gym_id, membresia_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Migración remota del ajuste financiero de bajas lista.");
}

try { await migrate(); } finally { await prisma.$disconnect(); }
