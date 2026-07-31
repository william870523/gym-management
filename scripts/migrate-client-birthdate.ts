/**
 * E0 — `cliente.fecha_nacimiento` (docs/PLAN_ESTADISTICAS.md §7-bis).
 *
 * Gemela MariaDB de `gym-local-api/scripts/migrate-client-birthdate.ts`. Mismo
 * comportamiento en dos pasos: añade la columna y rellena hacia atrás a los
 * socios con `tipo_documento = 'CI_CUBANO'` derivando la fecha de los 11
 * dígitos con el parser canónico.
 *
 * Sólo se escribe cuando el análisis del CI es **válido**. Lo que no se pueda
 * derivar se informa para revisión manual; la migración no lava datos malos.
 * Los socios con pasaporte u otro documento quedan en NULL a propósito.
 *
 * Exige un dump previo en `CLIENT_BIRTHDATE_BACKUP_PATH`, p. ej.:
 *   docker exec mariadb-hp mariadb-dump -u root -p... gym > dump.sql
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { analizarCubaCi } from "../src/application/clients/cuba-ci";
import { trustedClock } from "../src/config/trusted-clock";
import { prisma } from "../src/infrastructure/db/prismaClient";

async function tableColumns(table: string): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    table,
  );
  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function addColumn() {
  const columns = await tableColumns("cliente");
  if (columns.has("fecha_nacimiento")) {
    console.log("cliente.fecha_nacimiento ya existía.");
    return;
  }
  await prisma.$executeRawUnsafe(
    "ALTER TABLE cliente ADD COLUMN fecha_nacimiento DATETIME(3) NULL",
  );
  console.log("cliente.fecha_nacimiento añadida.");
}

async function backfill() {
  const referencia = trustedClock.nowUtc();
  const pendientes = await prisma.$queryRawUnsafe<
    Array<{ ci: string; sexo: string | null }>
  >(
    "SELECT ci, sexo FROM cliente " +
      "WHERE tipo_documento = 'CI_CUBANO' AND fecha_nacimiento IS NULL " +
      "AND is_deleted = 0",
  );

  let escritas = 0;
  const revisar: Array<{ ci: string; motivo: string }> = [];
  const sexoDiscrepante: string[] = [];

  for (const fila of pendientes) {
    const analisis = analizarCubaCi(fila.ci, { fechaReferencia: referencia });
    if (analisis.estado !== "valido" || analisis.fechaNacimiento === null) {
      revisar.push({
        ci: fila.ci,
        motivo:
          analisis.errores.map((error) => error.codigo).join(", ") ||
          analisis.estado,
      });
      continue;
    }
    await prisma.cliente.update({
      where: { ci: fila.ci },
      data: { fecha_nacimiento: analisis.fechaNacimiento },
    });
    escritas += 1;

    const declarado = (fila.sexo ?? "").trim().toLowerCase();
    const codificado = analisis.sexoCodificado;
    if (declarado.length > 0 && codificado !== null) {
      const coincide = declarado.startsWith(codificado === "masculino" ? "m" : "f");
      if (!coincide) sexoDiscrepante.push(fila.ci);
    }
  }

  console.log(`Fechas derivadas del CI y escritas: ${escritas}.`);
  if (revisar.length > 0) {
    console.log(
      `Carnés que NO se pudieron derivar y requieren revisión manual ` +
        `(${revisar.length}):`,
    );
    for (const fila of revisar) {
      console.log(`  ${fila.ci} — ${fila.motivo}`);
    }
  }
  if (sexoDiscrepante.length > 0) {
    console.log(
      `Aviso: el sexo declarado no coincide con el dígito 10 del CI en ` +
        `${sexoDiscrepante.length} socio(s): ${sexoDiscrepante.join(", ")}. ` +
        `No se modifica ninguno; se corrigen desde la ficha.`,
    );
  }
}

async function resumen() {
  const filas = await prisma.$queryRawUnsafe<
    Array<{ tipo: string; con_fecha: bigint | number; total: bigint | number }>
  >(
    "SELECT tipo_documento AS tipo, " +
      "SUM(CASE WHEN fecha_nacimiento IS NULL THEN 0 ELSE 1 END) AS con_fecha, " +
      "COUNT(*) AS total FROM cliente WHERE is_deleted = 0 " +
      "GROUP BY tipo_documento ORDER BY tipo_documento",
  );
  console.log(
    `cliente: ${JSON.stringify(
      filas.map((fila) => ({
        tipo: fila.tipo,
        con_fecha: Number(fila.con_fecha),
        total: Number(fila.total),
      })),
    )}`,
  );
}

async function migrate() {
  const backupPath = process.env.CLIENT_BIRTHDATE_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina CLIENT_BIRTHDATE_BACKUP_PATH con el dump MariaDB previo.",
    );
  }
  await addColumn();
  await backfill();
  await resumen();
}

try {
  await migrate();
} finally {
  await prisma.$disconnect();
}
