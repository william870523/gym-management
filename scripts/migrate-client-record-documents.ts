import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function migrate() {
  const backupPath = process.env.CLIENT_RECORD_DOCUMENT_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error("Defina CLIENT_RECORD_DOCUMENT_BACKUP_PATH con el dump MariaDB previo.");
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS cliente_expediente_documento (
      documento_id VARCHAR(191) NOT NULL,
      operacion_id VARCHAR(191) NOT NULL,
      ci VARCHAR(191) NOT NULL,
      formato VARCHAR(16) NOT NULL,
      destino VARCHAR(24) NOT NULL,
      nombre_archivo VARCHAR(191) NOT NULL,
      mime_type VARCHAR(96) NOT NULL,
      contenido LONGBLOB NOT NULL,
      tamano_bytes INT NOT NULL,
      sha256 VARCHAR(64) NOT NULL,
      filtros_json TEXT NOT NULL,
      emitido_por_user_id VARCHAR(191) NOT NULL,
      emitido_por_nombre_snapshot VARCHAR(191) NOT NULL,
      emitido_por_rol_snapshot VARCHAR(96) NOT NULL,
      emitido_por_origen VARCHAR(32) NOT NULL,
      emitido_at DATETIME(3) NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      gym_id VARCHAR(191) NOT NULL,
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (documento_id),
      UNIQUE KEY uq_cli_exp_doc_operacion (operacion_id),
      KEY idx_cli_exp_doc_cliente_fecha (gym_id, ci, emitido_at),
      KEY idx_cli_exp_doc_hash (gym_id, sha256)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log("Migración remota de documentos del expediente lista.");
}

try { await migrate(); } finally { await prisma.$disconnect(); }
