/**
 * Migración aditiva e idempotente de obligaciones fijas de entrenador.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.FIXED_OBLIGATION_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina FIXED_OBLIGATION_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS entrenador_obligacion_fija (
      obligacion_id VARCHAR(191) NOT NULL,
      perfil_compensacion_id VARCHAR(191) NOT NULL,
      id_entrenador VARCHAR(191) NOT NULL,
      moneda_id VARCHAR(191) NOT NULL,
      periodo_inicio DATETIME(3) NOT NULL,
      periodo_fin DATETIME(3) NOT NULL,
      fecha_programada DATETIME(3) NOT NULL,
      monto DECIMAL(18,2) NOT NULL,
      estado VARCHAR(32) NOT NULL DEFAULT 'PENDIENTE',
      metodo_prorrateo VARCHAR(32) NOT NULL,
      dias_cubiertos INT NOT NULL,
      dias_periodo INT NOT NULL,
      formula_snapshot_json TEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (obligacion_id),
      UNIQUE KEY uq_ent_obl_fija_periodo (perfil_compensacion_id, periodo_inicio, periodo_fin),
      KEY idx_ent_obl_fija_pago (gym_id, id_entrenador, estado, fecha_programada)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const count = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM entrenador_obligacion_fija",
  );
  console.log(`Migración remota lista; obligaciones: ${Number(count[0]?.total ?? 0)}.`);
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
