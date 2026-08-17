/**
 * M4b — cobro del plus multi-sede (MariaDB). Gemela de la de `gym-local-api`.
 *
 * Crea la tabla y nada más, por la misma razón que su gemela: marcar el plus
 * no cobraba nada hasta hoy, así que reconstruir un cobro por cada marca
 * fabricaría ingresos que nadie recibió.
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const COLUMNAS = new Set([
  "cobro_id", "ci", "gym_id", "cliente_acceso_multisede_id", "importe",
  "moneda_id", "cubre_desde", "cubre_hasta", "tipo_pago_id", "cuenta_id",
  "cobrado_por_user_id", "cobrado_por_nombre_snapshot",
  "cobrado_por_rol_snapshot", "cobrado_por_origen", "fecha", "source_device",
  "version", "is_deleted", "created_at", "updated_at", "deleted_at",
]);

const columnas = (tabla: string) =>
  prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tabla}'`,
  );

async function migrate() {
  const backupPath = process.env.COBRO_PLUS_BACKUP_PATH;
  if (
    !backupPath ||
    !existsSync(resolve(backupPath)) ||
    statSync(resolve(backupPath)).size <= 0
  ) {
    throw new Error(
      "Defina COBRO_PLUS_BACKUP_PATH con un dump MariaDB no vacío creado antes de migrar.",
    );
  }
  console.log(`Respaldo MariaDB verificado: ${resolve(backupPath)}`);

  if ((await columnas("acceso_multisede_cobro")).length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE acceso_multisede_cobro (
        cobro_id VARCHAR(191) NOT NULL,
        ci VARCHAR(191) NOT NULL,
        gym_id VARCHAR(191) NOT NULL,
        cliente_acceso_multisede_id VARCHAR(191) NOT NULL,
        importe DECIMAL(65,30) NOT NULL,
        moneda_id VARCHAR(191) NOT NULL,
        cubre_desde DATETIME(3) NOT NULL,
        cubre_hasta DATETIME(3) NOT NULL,
        tipo_pago_id VARCHAR(191) NULL,
        cuenta_id VARCHAR(191) NULL,
        cobrado_por_user_id VARCHAR(191) NOT NULL,
        cobrado_por_nombre_snapshot VARCHAR(191) NOT NULL,
        cobrado_por_rol_snapshot VARCHAR(191) NULL,
        cobrado_por_origen VARCHAR(191) NULL,
        fecha DATETIME(3) NOT NULL,
        source_device VARCHAR(191) NULL,
        version INT NOT NULL DEFAULT 1,
        is_deleted TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        PRIMARY KEY (cobro_id),
        KEY idx_acc_multisede_cobro_gym_fecha (gym_id, fecha),
        KEY idx_acc_multisede_cobro_ci (ci, cubre_hasta)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Tabla acceso_multisede_cobro creada.");
  } else {
    console.log("Tabla acceso_multisede_cobro ya existía; solo se verifica.");
  }

  const nombres = new Set(
    (await columnas("acceso_multisede_cobro")).map((c) => c.COLUMN_NAME),
  );
  const faltan = [...COLUMNAS].filter((nombre) => !nombres.has(nombre));
  if (faltan.length) {
    throw new Error(
      `Esquema M4b desconocido en acceso_multisede_cobro; faltan: ${faltan.join(", ")}`,
    );
  }

  const [{ total }] = await prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
    "SELECT COUNT(*) AS total FROM acceso_multisede_cobro",
  );
  console.log(`Migración lista. Cobros del plus: ${Number(total)}.`);
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
