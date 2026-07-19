/**
 * Migración aditiva e idempotente R5.4: tabla `aviso_administracion` en
 * MariaDB. Exige un dump verificable creado antes de ejecutarla.
 */
import { existsSync } from "fs";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.ADMIN_NOTICE_BACKUP_PATH;
  if (!backupPath || !existsSync(backupPath)) {
    throw new Error(
      "Defina ADMIN_NOTICE_BACKUP_PATH con el dump MariaDB creado antes de migrar.",
    );
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS aviso_administracion (
      aviso_id VARCHAR(191) NOT NULL,
      gym_id VARCHAR(191) NOT NULL,
      tipo VARCHAR(64) NOT NULL,
      referencia_id VARCHAR(191) NULL,
      mensaje TEXT NOT NULL,
      actor_user_id VARCHAR(191) NULL,
      actor_nombre VARCHAR(191) NULL,
      leido BOOLEAN NOT NULL DEFAULT false,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (aviso_id),
      KEY idx_aviso_admin_bandeja (gym_id, leido, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Migración remota lista: aviso_administracion creada.");
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
