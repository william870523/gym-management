/**
 * Migración aditiva e idempotente R5.2: calendario de cuotas del cliente en
 * planes largos. Exige un dump MariaDB verificable creado antes de ejecutarla.
 *
 * - Añade flag `acepta_cuotas` a `planes_pago` (default false = pago único).
 * - Crea `plan_cuota_esquema` (catálogo editable por plan).
 * - Crea `membresia_cuota` (cuotas materializadas al contratar).
 */
import { existsSync } from "fs";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.PLAN_INSTALLMENT_BACKUP_PATH;
  if (!backupPath || !existsSync(backupPath)) {
    throw new Error(
      "Defina PLAN_INSTALLMENT_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }

  const flagColumns = await prisma.$queryRawUnsafe<
    Array<{ COLUMN_NAME: string }>
  >(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planes_pago'
       AND COLUMN_NAME = 'acepta_cuotas'`,
  );
  const esquemaTables = await prisma.$queryRawUnsafe<
    Array<{ TABLE_NAME: string }>
  >(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_cuota_esquema'`,
  );
  const membresiaCuotaTables = await prisma.$queryRawUnsafe<
    Array<{ TABLE_NAME: string }>
  >(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'membresia_cuota'`,
  );

  if (
    flagColumns.length > 0 &&
    esquemaTables.length > 0 &&
    membresiaCuotaTables.length > 0
  ) {
    console.log("Migración remota ya aplicada: cuotas R5.2 existen.");
    return;
  }

  if (flagColumns.length === 0) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE planes_pago ADD COLUMN acepta_cuotas BOOLEAN NOT NULL DEFAULT false",
    );
    console.log("Flag acepta_cuotas añadido a planes_pago.");
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS plan_cuota_esquema (
      esquema_id VARCHAR(191) NOT NULL,
      gym_id VARCHAR(191) NOT NULL,
      plan_id VARCHAR(191) NOT NULL,
      numero_cuota INT NOT NULL,
      importe DECIMAL(18,2) NOT NULL,
      dias_cobertura INT NOT NULL,
      orden INT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (esquema_id),
      UNIQUE KEY uq_plan_cuota_numero (plan_id, numero_cuota),
      KEY idx_plan_cuota_plan (gym_id, plan_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS membresia_cuota (
      cuota_instancia_id VARCHAR(191) NOT NULL,
      gym_id VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NOT NULL,
      numero_cuota INT NOT NULL,
      importe DECIMAL(18,2) NOT NULL,
      dias_cobertura INT NOT NULL,
      fecha_exigible DATETIME(3) NOT NULL,
      fecha_cobertura_inicio DATETIME(3) NOT NULL,
      fecha_cobertura_fin DATETIME(3) NOT NULL,
      estado VARCHAR(32) NOT NULL DEFAULT 'PENDIENTE',
      fecha_pagada DATETIME(3) NULL,
      pago_detalle_id VARCHAR(191) NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (cuota_instancia_id),
      UNIQUE KEY uq_membresia_cuota_numero (membresia_id, numero_cuota),
      KEY idx_membresia_cuota_mora (gym_id, estado, fecha_exigible),
      KEY idx_membresia_cuota_orden (membresia_id, numero_cuota)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log("Migración remota lista: cuotas R5.2 creadas.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
