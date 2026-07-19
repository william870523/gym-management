/**
 * Migración aditiva e idempotente de perfiles de compensación.
 * Exige un dump MariaDB verificable creado antes de su ejecución.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function addColumn(name: string, definition: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COUNT(*) AS total
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'entrenador_comision_devengo'
        AND COLUMN_NAME = ?`,
    name,
  );
  if (Number(rows[0]?.total ?? 0) > 0) return;
  await prisma.$executeRawUnsafe(
    `ALTER TABLE entrenador_comision_devengo ADD COLUMN ${name} ${definition}`,
  );
}

async function migrate() {
  const backupPath = process.env.COMPENSATION_PROFILE_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina COMPENSATION_PROFILE_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS entrenador_compensacion_perfil (
      perfil_id VARCHAR(191) NOT NULL,
      id_entrenador VARCHAR(191) NOT NULL,
      modalidad VARCHAR(32) NOT NULL,
      metodo_devengo VARCHAR(32) NOT NULL,
      frecuencia_desembolso VARCHAR(32) NOT NULL,
      dia_corte INT NULL,
      monto_fijo DECIMAL(18,2) NULL,
      moneda_id VARCHAR(191) NULL,
      cuenta_preferida_id VARCHAR(191) NULL,
      activo BOOLEAN NOT NULL DEFAULT true,
      fecha_inicio DATETIME(3) NOT NULL,
      fecha_fin DATETIME(3) NULL,
      notas TEXT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (perfil_id),
      KEY idx_ent_comp_perfil_vigencia (gym_id, id_entrenador, activo, fecha_inicio)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumn("perfil_compensacion_id", "VARCHAR(191) NULL");
  await addColumn("modalidad_compensacion", "VARCHAR(32) NULL");
  await addColumn("metodo_devengo", "VARCHAR(32) NULL");
  await addColumn("frecuencia_desembolso", "VARCHAR(32) NULL");
  await addColumn("dia_corte", "INT NULL");
  await addColumn("cuenta_preferida_id", "VARCHAR(191) NULL");

  const count = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM entrenador_compensacion_perfil",
  );
  console.log(`Migración remota lista; perfiles: ${Number(count[0]?.total ?? 0)}.`);
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
