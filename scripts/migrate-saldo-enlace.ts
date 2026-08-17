/**
 * M4b — libro del saldo entre partes (MariaDB). Gemela de la de
 * `gym-local-api`.
 *
 * Crea la tabla y nada más, por la misma razón que su gemela: hasta hoy no
 * existía el cobro por cuenta ajena, así que el saldo correcto de todas las
 * sedes es cero, y sembrar asientos de arranque fabricaría deudas que nadie
 * contrajo.
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const COLUMNAS = new Set([
  "asiento_id", "gym_id", "acreedor_tipo", "acreedor_gym_id", "moneda_id",
  "monto", "sentido", "clase_cobro", "origen_tipo", "origen_id",
  "clave_origen", "ci", "ocurrido_at", "fecha_negocio", "source_device",
  "version", "is_deleted", "created_at", "updated_at", "deleted_at",
]);

const columnas = (tabla: string) =>
  prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tabla}'`,
  );

async function migrate() {
  const backupPath = process.env.SALDO_ENLACE_BACKUP_PATH;
  if (
    !backupPath ||
    !existsSync(resolve(backupPath)) ||
    statSync(resolve(backupPath)).size <= 0
  ) {
    throw new Error(
      "Defina SALDO_ENLACE_BACKUP_PATH con un dump MariaDB no vacío creado antes de migrar.",
    );
  }
  console.log(`Respaldo MariaDB verificado: ${resolve(backupPath)}`);

  if ((await columnas("saldo_enlace_asiento")).length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE saldo_enlace_asiento (
        asiento_id VARCHAR(191) NOT NULL,
        gym_id VARCHAR(191) NOT NULL,
        acreedor_tipo VARCHAR(191) NOT NULL,
        acreedor_gym_id VARCHAR(191) NULL,
        moneda_id VARCHAR(191) NOT NULL,
        monto DECIMAL(65,30) NOT NULL,
        sentido VARCHAR(191) NOT NULL,
        clase_cobro VARCHAR(191) NOT NULL,
        origen_tipo VARCHAR(191) NOT NULL,
        origen_id VARCHAR(191) NOT NULL,
        clave_origen VARCHAR(191) NOT NULL,
        ci VARCHAR(191) NULL,
        ocurrido_at DATETIME(3) NOT NULL,
        fecha_negocio DATETIME(3) NOT NULL,
        source_device VARCHAR(191) NULL,
        version INT NOT NULL DEFAULT 1,
        is_deleted TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        PRIMARY KEY (asiento_id),
        UNIQUE KEY uq_saldo_enlace_gym_origen (gym_id, clave_origen),
        KEY idx_saldo_enlace_acreedor (gym_id, acreedor_tipo, acreedor_gym_id, moneda_id),
        KEY idx_saldo_enlace_gym_dia (gym_id, fecha_negocio),
        KEY idx_saldo_enlace_origen (gym_id, origen_tipo, origen_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Tabla saldo_enlace_asiento creada.");
  } else {
    console.log("Tabla saldo_enlace_asiento ya existía; solo se verifica.");
  }

  const nombres = new Set((await columnas("saldo_enlace_asiento")).map((c) => c.COLUMN_NAME));
  const faltan = [...COLUMNAS].filter((nombre) => !nombres.has(nombre));
  if (faltan.length) {
    throw new Error(
      `Esquema M4b desconocido en saldo_enlace_asiento; faltan: ${faltan.join(", ")}`,
    );
  }

  const [{ total }] = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM saldo_enlace_asiento",
  );
  console.log(`Migración M4b lista. Asientos: ${Number(total)}.`);
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
