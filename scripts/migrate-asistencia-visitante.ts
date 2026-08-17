/**
 * M4a — la asistencia deja de exigir que el socio esté en `cliente` (MariaDB).
 * Gemela de la de `gym-local-api`; allí está escrito el porqué completo.
 *
 * En el remoto la restricción no estorbaba —el concentrador tiene a todos los
 * socios de todas las sedes— pero se retira igual: si una base la tiene y la
 * otra no, la misma asistencia se acepta en un lado y se rechaza en el otro, y
 * eso es una divergencia esperando a que alguien la encuentre de noche.
 */
import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";

const clavesForaneas = () =>
  prisma.$queryRawUnsafe<Array<{ CONSTRAINT_NAME: string }>>(
    "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asistencia' " +
      "AND REFERENCED_TABLE_NAME IS NOT NULL",
  );

async function migrate() {
  const backupPath = process.env.ASISTENCIA_VISITANTE_BACKUP_PATH;
  if (
    !backupPath ||
    !existsSync(resolve(backupPath)) ||
    statSync(resolve(backupPath)).size <= 0
  ) {
    throw new Error(
      "Defina ASISTENCIA_VISITANTE_BACKUP_PATH con un dump MariaDB no vacío creado antes de migrar.",
    );
  }

  const antes = await clavesForaneas();
  const filasAntes = await prisma.asistencia.count();
  for (const fk of antes) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE asistencia DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``,
    );
  }

  const despues = await clavesForaneas();
  if (despues.length !== 0) {
    throw new Error(
      `La tabla conserva claves foráneas: ${despues.map((f) => f.CONSTRAINT_NAME).join(", ")}.`,
    );
  }
  const filasDespues = await prisma.asistencia.count();
  if (filasDespues !== filasAntes) {
    throw new Error(
      `La migración alteró el número de filas: antes ${filasAntes}, después ${filasDespues}.`,
    );
  }

  console.log(
    `M4a asistencia remoto: retiradas ${antes.length} claves foráneas · ` +
      `filas ${filasDespues} intactas · backup ${resolve(backupPath)}`,
  );
}

try { await migrate(); } finally { await prisma.$disconnect(); }
