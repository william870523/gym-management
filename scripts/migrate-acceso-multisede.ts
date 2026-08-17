/**
 * M4a — acceso multi-sede: precio global del plus y suscripción por socio
 * (MariaDB). Gemela de la de `gym-local-api`.
 *
 * No siembra ningún precio, por la misma razón que su gemela: el
 * `precio_snapshot` se congela al marcar y un precio inventado quedaría pegado
 * a socios reales.
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const COLUMNAS_PRECIO = new Set([
  "acceso_multisede_precio_id", "precio", "moneda_id", "source_device",
  "is_deleted", "created_at", "version", "updated_at", "deleted_at",
]);

const COLUMNAS_VISITANTE = new Set([
  "ci", "gym_id_origen", "nombres", "apellidos", "tipo_documento",
  "foto_cliente", "membresia_estado", "membresia_fecha_fin", "source_device",
  "version", "is_deleted", "created_at", "updated_at", "deleted_at",
]);

const COLUMNAS_ACCESO = new Set([
  "cliente_acceso_multisede_id", "ci", "gym_id", "activo", "vigente_hasta",
  "precio_snapshot", "moneda_id", "marcado_por_user_id", "marcado_en_gym_id",
  "source_device", "version", "is_deleted", "created_at", "updated_at",
  "deleted_at",
]);

const columnas = (tabla: string) =>
  prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tabla}'`,
  );

async function verificar(tabla: string, esperadas: Set<string>) {
  const nombres = new Set((await columnas(tabla)).map((columna) => columna.COLUMN_NAME));
  const faltan = [...esperadas].filter((nombre) => !nombres.has(nombre));
  if (faltan.length) {
    throw new Error(`Esquema M4a desconocido en ${tabla}; faltan: ${faltan.join(", ")}`);
  }
}

async function migrate() {
  const backupPath = process.env.ACCESO_MULTISEDE_BACKUP_PATH;
  if (
    !backupPath ||
    !existsSync(resolve(backupPath)) ||
    statSync(resolve(backupPath)).size <= 0
  ) {
    throw new Error(
      "Defina ACCESO_MULTISEDE_BACKUP_PATH con un dump MariaDB no vacío creado antes de migrar.",
    );
  }

  if ((await columnas("acceso_multisede_precio")).length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE acceso_multisede_precio (
        acceso_multisede_precio_id VARCHAR(191) NOT NULL,
        precio DECIMAL(14,2) NOT NULL,
        moneda_id VARCHAR(191) NOT NULL,
        source_device VARCHAR(191) NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        version INTEGER NOT NULL DEFAULT 1,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        PRIMARY KEY (acceso_multisede_precio_id)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }

  if ((await columnas("cliente_acceso_multisede")).length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE cliente_acceso_multisede (
        cliente_acceso_multisede_id VARCHAR(191) NOT NULL,
        ci VARCHAR(191) NOT NULL,
        gym_id VARCHAR(191) NULL,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        vigente_hasta DATETIME(3) NOT NULL,
        precio_snapshot DECIMAL(14,2) NOT NULL,
        moneda_id VARCHAR(191) NOT NULL,
        marcado_por_user_id VARCHAR(191) NOT NULL,
        marcado_en_gym_id VARCHAR(191) NOT NULL,
        source_device VARCHAR(191) NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        PRIMARY KEY (cliente_acceso_multisede_id),
        UNIQUE KEY cliente_acceso_multisede_ci_key (ci),
        KEY cliente_acceso_multisede_gym_id_activo_is_deleted_idx
          (gym_id, activo, is_deleted),
        KEY cliente_acceso_multisede_vigente_hasta_idx (vigente_hasta)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }

  if ((await columnas("cliente_visitante")).length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE cliente_visitante (
        ci VARCHAR(191) NOT NULL,
        gym_id_origen VARCHAR(191) NOT NULL,
        nombres VARCHAR(191) NOT NULL,
        apellidos VARCHAR(191) NOT NULL,
        tipo_documento VARCHAR(191) NOT NULL DEFAULT 'DESCONOCIDO',
        foto_cliente LONGBLOB NULL,
        membresia_estado VARCHAR(191) NULL,
        membresia_fecha_fin DATETIME(3) NULL,
        source_device VARCHAR(191) NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        PRIMARY KEY (ci),
        KEY cliente_visitante_gym_id_origen_is_deleted_idx (gym_id_origen, is_deleted)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }

  await verificar("acceso_multisede_precio", COLUMNAS_PRECIO);
  await verificar("cliente_visitante", COLUMNAS_VISITANTE);
  await verificar("cliente_acceso_multisede", COLUMNAS_ACCESO);

  console.log(
    `M4a remoto: tablas verificadas · precios ${await prisma.accesoMultisedePrecio.count()} ` +
      `· accesos ${await prisma.clienteAccesoMultisede.count()} ` +
      `· visitantes ${await prisma.clienteVisitante.count()} · backup ${resolve(backupPath)}`,
  );
}

try { await migrate(); } finally { await prisma.$disconnect(); }
