/**
 * M4c — `pago_cliente.cobrado_en_gym_id` (MariaDB). Gemela de la de `gym-local-api`.
 *
 * Añade la columna y **no rellena nada**: hasta hoy nadie podía cobrar fuera de
 * su sede, así que en toda la historia el efectivo entró donde se ingresó y
 * `NULL` significa exactamente eso. Rellenarla con `gym_id` inventaría un dato
 * que nadie registró y borraría la diferencia entre «no aplica» y «coincide».
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function backupMariadb() {
  const ruta = process.env.COBRO_CRUZADO_BACKUP_PATH;
  if (!ruta || !existsSync(resolve(ruta)) || statSync(resolve(ruta)).size <= 0) {
    throw new Error(
      "Defina COBRO_CRUZADO_BACKUP_PATH con un dump MariaDB no vacío creado antes de migrar.",
    );
  }
  console.log(`Respaldo MariaDB verificado: ${resolve(ruta)}`);
  return resolve(ruta);
}

const columnas = () =>
  prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pago_cliente'",
  );

try {
  const backup = await backupMariadb();
  const nombres = new Set((await columnas()).map((c) => c.COLUMN_NAME));
  if (!nombres.has("cobrado_en_gym_id")) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE pago_cliente ADD COLUMN cobrado_en_gym_id VARCHAR(191) NULL",
    );
    console.log("Columna cobrado_en_gym_id creada.");
  } else {
    console.log("Columna cobrado_en_gym_id ya existía; solo se verifica.");
  }
  if (!new Set((await columnas()).map((c) => c.COLUMN_NAME)).has("cobrado_en_gym_id")) {
    throw new Error("La columna cobrado_en_gym_id no quedó creada.");
  }
  const [{ total, cruzados }] = await prisma.$queryRawUnsafe<
    Array<{ total: bigint; cruzados: bigint }>
  >(
    "SELECT COUNT(*) AS total, " +
      "SUM(CASE WHEN cobrado_en_gym_id IS NOT NULL THEN 1 ELSE 0 END) AS cruzados " +
      "FROM pago_cliente",
  );
  console.log(
    `Migración M4c lista. Cobros: ${Number(total)}, con caja ajena: ` +
      `${Number(cruzados ?? 0)}. Respaldo: ${backup}`,
  );
} finally {
  await prisma.$disconnect();
}
