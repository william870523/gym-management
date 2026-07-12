/**
 * Migración idempotente (MariaDB): añade las columnas de pausa de permanencia
 * a `asistencia` (pausa_inicio DATETIME(3) NULL, pausa_ms INT DEFAULT 0).
 *
 * Sigue el invariante 9 de AGENTS.md: nada de `prisma migrate dev` / `db push`
 * sobre una base con datos — solo ALTER aditivo revisado. En producción,
 * respaldar MariaDB (mysqldump) antes de ejecutar.
 *
 * Uso: bun run migrate:asistencia-pausa
 */
import { prisma } from "../src/infrastructure/db/prismaClient";

interface ColumnRow {
  COLUMN_NAME: string;
}

try {
  const columns = await prisma.$queryRawUnsafe<ColumnRow[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asistencia'`,
  );
  const names = new Set(columns.map((c) => c.COLUMN_NAME));

  if (!names.has("pausa_inicio")) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE asistencia ADD COLUMN pausa_inicio DATETIME(3) NULL",
    );
    console.log("Added asistencia.pausa_inicio");
  } else {
    console.log("asistencia.pausa_inicio already exists");
  }

  if (!names.has("pausa_ms")) {
    await prisma.$executeRawUnsafe(
      "ALTER TABLE asistencia ADD COLUMN pausa_ms INT NOT NULL DEFAULT 0",
    );
    console.log("Added asistencia.pausa_ms");
  } else {
    console.log("asistencia.pausa_ms already exists");
  }
} finally {
  await prisma.$disconnect();
}
