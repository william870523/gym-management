/** M3 — tabla global-con-excepción para recargos por método (MariaDB). */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { parseExchangeRateSurcharges } from "../src/domain/exchange-rate-surcharge-policy";
import { surchargeScopeId } from "../src/application/payment/rate-surcharge-scope.service";

const EXPECTED_COLUMNS = new Set([
  "tipo_cambio_recargo_id", "tipo_cambio_id", "tipo_pago_id", "gym_id",
  "porcentaje", "source_device", "is_deleted", "created_at", "version",
  "updated_at", "deleted_at",
]);
const columns = () => prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tipo_cambio_recargo'",
);

async function migrate() {
  const backupPath = process.env.CATALOG_SCOPE_M3_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath)) || statSync(resolve(backupPath)).size <= 0) {
    throw new Error("Defina CATALOG_SCOPE_M3_BACKUP_PATH con un dump MariaDB no vacío creado antes de migrar.");
  }
  if ((await columns()).length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE tipo_cambio_recargo (
        tipo_cambio_recargo_id VARCHAR(191) NOT NULL,
        tipo_cambio_id VARCHAR(191) NOT NULL,
        tipo_pago_id VARCHAR(191) NOT NULL,
        gym_id VARCHAR(191) NOT NULL DEFAULT 'GLOBAL',
        porcentaje DECIMAL(5,2) NOT NULL,
        source_device VARCHAR(191) NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        version INTEGER NOT NULL DEFAULT 1,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        deleted_at DATETIME(3) NULL,
        PRIMARY KEY (tipo_cambio_recargo_id),
        UNIQUE KEY tipo_cambio_recargo_tipo_cambio_id_tipo_pago_id_gym_id_key
          (tipo_cambio_id, tipo_pago_id, gym_id),
        KEY tipo_cambio_recargo_gym_id_tipo_cambio_id_is_deleted_idx
          (gym_id, tipo_cambio_id, is_deleted)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
  }
  const names = new Set((await columns()).map((column) => column.COLUMN_NAME));
  const missing = [...EXPECTED_COLUMNS].filter((name) => !names.has(name));
  if (missing.length) throw new Error(`Esquema M3 desconocido; faltan: ${missing.join(", ")}`);

  const rates = await prisma.tipoCambio.findMany({
    where: { recargos_json: { not: null } },
    select: { tipo_cambio_id: true, recargos_json: true, created_at: true, updated_at: true },
  });
  let inserted = 0;
  for (const rate of rates) {
    for (const [paymentTypeId, percentage] of Object.entries(parseExchangeRateSurcharges(rate.recargos_json))) {
      const id = surchargeScopeId(rate.tipo_cambio_id, paymentTypeId, "GLOBAL");
      if (await prisma.tipoCambioRecargo.findUnique({ where: { tipo_cambio_recargo_id: id } })) continue;
      await prisma.tipoCambioRecargo.create({
        data: {
          tipo_cambio_recargo_id: id, tipo_cambio_id: rate.tipo_cambio_id,
          tipo_pago_id: paymentTypeId, gym_id: "GLOBAL", porcentaje: percentage,
          source_device: "MIGRATION_M3", created_at: rate.created_at ?? rate.updated_at,
          updated_at: rate.updated_at, version: 1,
        },
      });
      inserted += 1;
    }
  }
  console.log(
    `M3 remoto: tabla verificada · filas ${await prisma.tipoCambioRecargo.count()} ` +
      `· legado incorporado ${inserted} · backup ${resolve(backupPath)}`,
  );
}

try { await migrate(); } finally { await prisma.$disconnect(); }
