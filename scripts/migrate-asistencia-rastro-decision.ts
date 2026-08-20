/**
 * Migración idempotente (MariaDB): añade a `asistencia` el rastro de con qué se
 * decidió la entrada de un visitante (docs/MULTI_SEDE.md §5.2).
 *
 *   decidido_con            VARCHAR(20) NULL   CONCENTRADOR | COPIA_LOCAL
 *   conocimiento_al_decidir VARCHAR(20) NULL   AL_DIA | CON_RETRASO | A_CIEGAS
 *   dias_sin_noticias       INT NULL
 *
 * Aditiva y anulable a propósito: las entradas que ya existen **no se rellenan**
 * con un valor por defecto. Poner `CONCENTRADOR` en filas de las que nadie sabe
 * cómo se decidieron afirmaría algo que no consta, y es justo lo contrario de
 * para lo que existen estas columnas. `null` se lee como «no consta».
 *
 * Gemela de la de `gym-local-api`: las dos bases se migran juntas o no se migra
 * ninguna (regla 1 de CLAUDE.md). Respaldar MariaDB (mariadb-dump) antes.
 *
 * Uso: bun run migrate:asistencia-rastro-decision
 */
import { prisma } from "../src/infrastructure/db/prismaClient";

interface ColumnRow {
  COLUMN_NAME: string;
}

const COLUMNAS: Array<[string, string]> = [
  ["decidido_con", "VARCHAR(20) NULL"],
  ["conocimiento_al_decidir", "VARCHAR(20) NULL"],
  ["dias_sin_noticias", "INT NULL"],
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
