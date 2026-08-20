/**
 * Migración idempotente (MariaDB): añade a `asistencia` el **segundo eje** del
 * rastro — cuánto hacía que se sabía de la sede del socio (§5.2).
 *
 *   conocimiento_origen_al_decidir VARCHAR(20) NULL   AL_DIA | CON_RETRASO |
 *                                                     A_CIEGAS | NO_CONSTA
 *   dias_sin_noticias_origen       INT NULL
 *
 * Aditiva y anulable, y las filas anteriores **no se rellenan**: `NO_CONSTA` es
 * un valor que alguien midió y no encontró; `null` es que nadie lo midió. En una
 * columna que existe para saber de cuándo era el dato, confundirlos la
 * inutilizaría.
 *
 * Gemela de la de `gym-local-api`: las dos bases se migran juntas o no se migra
 * ninguna (regla 1 de CLAUDE.md). Respaldar MariaDB (mariadb-dump) antes.
 *
 * Uso: bun run migrate:asistencia-noticia-origen
 */
import { prisma } from "../src/infrastructure/db/prismaClient";

interface ColumnRow {
  COLUMN_NAME: string;
}

const COLUMNAS: Array<[string, string]> = [
  ["conocimiento_origen_al_decidir", "VARCHAR(20) NULL"],
  ["dias_sin_noticias_origen", "INT NULL"],
];

try {
  const columns = await prisma.$queryRawUnsafe<ColumnRow[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asistencia'`,
  );
  const names = new Set(columns.map((c) => c.COLUMN_NAME));

  for (const [nombre, tipo] of COLUMNAS) {
    if (names.has(nombre)) {
      console.log(`asistencia.${nombre} already exists`);
      continue;
    }
    await prisma.$executeRawUnsafe(
      `ALTER TABLE asistencia ADD COLUMN ${nombre} ${tipo}`,
    );
    console.log(`Added asistencia.${nombre}`);
  }
} finally {
  await prisma.$disconnect();
}
