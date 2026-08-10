/**
 * E0-b — catálogo de motivos de baja (docs/PLAN_ESTADISTICAS.md §7-ter).
 *
 * Gemela MariaDB de `gym-local-api/scripts/migrate-dropout-reasons.ts`. Crea
 * `motivo_baja`, añade `retencion_gestion.motivo_baja_id` y
 * `motivo_nombre_snapshot`, y siembra los diez motivos base por gimnasio.
 *
 * Exige un dump previo en `DROPOUT_REASON_BACKUP_PATH`, p. ej.:
 *   docker exec mariadb-hp mariadb-dump -u root -p... gym > dump.sql
 */
import { createHash } from "crypto";
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

/**
 * Instante declarado de siembra del catálogo. Debe ser **idéntico** al de
 * `gym-local-api/scripts/migrate-dropout-reasons.ts`: el catálogo se siembra por
 * separado en cada base y dejar la fecha al `DEFAULT CURRENT_TIMESTAMP` hacía
 * divergir las diez filas.
 */
const SEMBRADO_EN = new Date("2026-01-01T00:00:00.000Z");

const MOTIVOS_BASE: ReadonlyArray<{ codigo: string; nombre: string }> = [
  { codigo: "PRECIO", nombre: "Precio" },
  { codigo: "HORARIO", nombre: "Horario" },
  { codigo: "MUDANZA", nombre: "Mudanza" },
  { codigo: "SALUD_LESION", nombre: "Salud o lesión" },
  { codigo: "OTRO_GIMNASIO", nombre: "Se fue a otro gimnasio" },
  { codigo: "SIN_RESULTADOS", nombre: "No vio resultados" },
  { codigo: "FALTA_TIEMPO", nombre: "Falta de tiempo" },
  { codigo: "INSATISFECHO_SERVICIO", nombre: "Insatisfecho con el servicio" },
  { codigo: "VIAJE_TEMPORAL", nombre: "Viaje temporal" },
  { codigo: "OTRO", nombre: "Otro" },
];

function motivoId(gymId: string, codigo: string) {
  return `mbaja-${createHash("sha256")
    .update(`${gymId}|${codigo}`)
    .digest("hex")
    .slice(0, 24)}`;
}

async function tableColumns(table: string): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    table,
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function migrate() {
  const backupPath = process.env.DROPOUT_REASON_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina DROPOUT_REASON_BACKUP_PATH con el dump MariaDB previo.",
    );
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS motivo_baja (
      motivo_baja_id VARCHAR(191) NOT NULL,
      gym_id VARCHAR(191) NOT NULL,
      nombre VARCHAR(191) NOT NULL,
      codigo VARCHAR(64) NULL,
      orden INT NOT NULL DEFAULT 0,
      activo BOOLEAN NOT NULL DEFAULT true,
      es_sistema BOOLEAN NOT NULL DEFAULT false,
      is_deleted BOOLEAN NOT NULL DEFAULT false,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      source_device VARCHAR(191) NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      deleted_at DATETIME(3) NULL,
      PRIMARY KEY (motivo_baja_id),
      UNIQUE KEY uq_motivo_baja_nombre (gym_id, nombre),
      KEY idx_motivo_baja_gym_activo (gym_id, activo, orden)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const columnas = await tableColumns("retencion_gestion");
  if (!columnas.has("motivo_baja_id")) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE retencion_gestion ADD COLUMN motivo_baja_id VARCHAR(191) NULL",
    );
    console.log("retencion_gestion.motivo_baja_id añadida.");
  }
  if (!columnas.has("motivo_nombre_snapshot")) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE retencion_gestion " +
        "ADD COLUMN motivo_nombre_snapshot VARCHAR(191) NULL",
    );
    console.log("retencion_gestion.motivo_nombre_snapshot añadida.");
  }

  // Siembra por gimnasio. Idempotente: solo inserta los que falten y no toca
  // los existentes, para no pisar renombres del operador.
  const gyms = await prisma.gym.findMany({ select: { gym_id: true } });
  let sembrados = 0;
  let alineados = 0;
  for (const gym of gyms) {
    for (const [indice, motivo] of MOTIVOS_BASE.entries()) {
      const existe = await prisma.motivoBaja.findFirst({
        where: { gym_id: gym.gym_id, nombre: motivo.nombre },
        select: { motivo_baja_id: true, created_at: true },
      });
      if (existe) {
        // Gemelo exacto del local: sin instante declarado, cada base guardaba
        // la hora de SU migración y las diez filas divergían para siempre
        // (huella del 01-08-2026). Se alinea solo `created_at`; los renombres
        // del operador se respetan como hasta ahora.
        if (existe.created_at?.getTime() !== SEMBRADO_EN.getTime()) {
          await prisma.motivoBaja.update({
            where: { motivo_baja_id: existe.motivo_baja_id },
            data: { created_at: SEMBRADO_EN },
          });
          alineados += 1;
        }
        continue;
      }
      await prisma.motivoBaja.create({
        data: {
          motivo_baja_id: motivoId(gym.gym_id, motivo.codigo),
          gym_id: gym.gym_id,
          nombre: motivo.nombre,
          codigo: motivo.codigo,
          orden: indice + 1,
          activo: true,
          es_sistema: true,
          created_at: SEMBRADO_EN,
        },
      });
      sembrados += 1;
    }
  }
  if (alineados) console.log(`created_at alineado en ${alineados} motivos de sistema.`);

  const total = await prisma.motivoBaja.count();
  const conMotivo = await prisma.retencionGestion.count({
    where: { motivo_baja_id: { not: null } },
  });
  const gestiones = await prisma.retencionGestion.count();
  console.log(
    `Migración remota lista; motivos sembrados: ${sembrados}. ` +
      `Totales → motivos: ${total}, gestiones: ${gestiones}, ` +
      `gestiones con motivo codificado: ${conMotivo}.`,
  );
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
