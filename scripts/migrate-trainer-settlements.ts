/**
 * Migración aditiva e idempotente de liquidaciones de entrenador.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.TRAINER_SETTLEMENT_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina TRAINER_SETTLEMENT_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS entrenador_liquidacion (
      liquidacion_id VARCHAR(191) NOT NULL,
      operacion_id VARCHAR(191) NOT NULL,
      comprobante_numero VARCHAR(191) NOT NULL,
      intencion_firma TEXT NOT NULL,
      id_entrenador VARCHAR(191) NOT NULL,
      moneda_id VARCHAR(191) NOT NULL,
      cuenta_id VARCHAR(191) NOT NULL,
      tipo_pago_id VARCHAR(191) NOT NULL,
      monto_total DECIMAL(18,2) NOT NULL,
      estado VARCHAR(32) NOT NULL DEFAULT 'PAGADA',
      notas TEXT NULL,
      pagada_por_user_id VARCHAR(191) NOT NULL,
      pagada_por_nombre_snapshot VARCHAR(191) NOT NULL,
      pagada_at DATETIME(3) NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (liquidacion_id),
      UNIQUE KEY uq_ent_liq_operacion (operacion_id),
      UNIQUE KEY uq_ent_liq_gym_comprobante (gym_id, comprobante_numero),
      KEY idx_ent_liq_gym_fecha (gym_id, pagada_at),
      KEY idx_ent_liq_entrenador_estado (gym_id, id_entrenador, estado)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS entrenador_liquidacion_aplicacion (
      aplicacion_id VARCHAR(191) NOT NULL,
      liquidacion_id VARCHAR(191) NOT NULL,
      cuota_id VARCHAR(191) NOT NULL,
      monto_aplicado DECIMAL(18,2) NOT NULL,
      estado VARCHAR(32) NOT NULL DEFAULT 'APLICADA',
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (aplicacion_id),
      UNIQUE KEY uq_ent_liq_app_cuota (liquidacion_id, cuota_id),
      KEY idx_ent_liq_app_cuota_estado (gym_id, cuota_id, estado),
      KEY idx_ent_liq_app_liquidacion (gym_id, liquidacion_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS entrenador_liquidacion_reversion (
      reversion_id VARCHAR(191) NOT NULL,
      liquidacion_id VARCHAR(191) NOT NULL,
      operacion_id VARCHAR(191) NOT NULL,
      motivo TEXT NOT NULL,
      monto_total DECIMAL(18,2) NOT NULL,
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
      PRIMARY KEY (reversion_id),
      UNIQUE KEY uq_ent_liq_rev_liquidacion (liquidacion_id),
      UNIQUE KEY uq_ent_liq_rev_operacion (operacion_id),
      KEY idx_ent_liq_rev_gym_fecha (gym_id, registrada_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const count = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM entrenador_liquidacion",
  );
  console.log(
    `Migración remota de liquidaciones lista; registros: ${Number(count[0]?.total ?? 0)}.`,
  );
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
