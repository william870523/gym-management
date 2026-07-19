/**
 * Migración aditiva e idempotente de reversiones de cobro.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.PAYMENT_REVERSAL_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina PAYMENT_REVERSAL_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS pago_reversion (
      reversion_id VARCHAR(191) NOT NULL,
      pago_cliente_id VARCHAR(191) NOT NULL,
      operacion_id VARCHAR(191) NOT NULL,
      tipo VARCHAR(32) NOT NULL DEFAULT 'ANULACION',
      motivo TEXT NOT NULL,
      ci VARCHAR(191) NOT NULL,
      membresia_id VARCHAR(191) NULL,
      monto_total DOUBLE NOT NULL,
      moneda_id VARCHAR(191) NOT NULL,
      registrada_por_user_id VARCHAR(191) NOT NULL,
      registrada_por_nombre_snapshot VARCHAR(191) NOT NULL,
      registrada_at DATETIME(3) NOT NULL,
      resumen_json LONGTEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (reversion_id),
      UNIQUE KEY uq_pago_rev_pago (pago_cliente_id),
      UNIQUE KEY uq_pago_rev_operacion (operacion_id),
      KEY idx_pago_rev_gym_fecha (gym_id, registrada_at),
      KEY idx_pago_rev_ci_fecha (ci, registrada_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const count = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM pago_reversion",
  );
  console.log(`Migración remota de reversiones lista; registros: ${Number(count[0]?.total ?? 0)}.`);
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
