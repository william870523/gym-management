/**
 * Catálogos globales canónicos — envoltorio MariaDB.
 *
 * Gemela SQLite: `gym-local-api/scripts/migrate-catalogos-globales.ts`. La
 * canonización vive en `scripts/catalogos-globales.ts` (raíz del monorepo) y es
 * la misma para las dos bases; aquí solo se le da el cliente Prisma remoto y la
 * forma MariaDB de citar identificadores y de listar tablas por columna.
 *
 * Exige un dump previo en `CATALOGOS_GLOBALES_BACKUP_PATH`, p. ej.:
 *   docker exec mariadb-hp mariadb-dump -u root -p... gym > dump.sql
 *
 * Uso:
 *   bun run migrate:catalogos-globales -- --simular   (mide, no escribe)
 *   bun run migrate:catalogos-globales
 *   bun run migrate:catalogos-globales -- --reasignar-a-nacional
 *
 * `--reasignar-a-nacional` devuelve a CUP las filas tarifadas en una moneda que
 * se retira, en vez de dejar la moneda en pie. Ver `OpcionesCanonizacion`.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  canonizarCatalogosGlobales,
  imprimirInforme,
  type AdaptadorBase,
} from "../../scripts/catalogos-globales";

const simular = process.argv.includes("--simular");
const reasignarAMonedaNacional = process.argv.includes("--reasignar-a-nacional");

const adaptador: AdaptadorBase = {
  nombre: "MariaDB (gym-remote-api)",
  citar: (identificador) => `\`${identificador.replaceAll("`", "``")}\``,
  async tablasConColumna(columna) {
    const filas = await prisma.$queryRawUnsafe<Array<{ tabla: string }>>(
      "SELECT TABLE_NAME AS tabla FROM information_schema.COLUMNS " +
        "WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = ? " +
        "ORDER BY TABLE_NAME",
      columna,
    );
    return filas.map((fila) => fila.tabla);
  },
};

if (!simular) {
  const respaldo = process.env.CATALOGOS_GLOBALES_BACKUP_PATH;
  if (!respaldo || !existsSync(resolve(respaldo))) {
    throw new Error(
      "Defina CATALOGOS_GLOBALES_BACKUP_PATH con el dump MariaDB previo.",
    );
  }
  console.log(`Respaldo declarado: ${resolve(respaldo)}`);
}

try {
  imprimirInforme(
    await canonizarCatalogosGlobales(prisma, adaptador, {
      simular,
      reasignarAMonedaNacional,
    }),
  );
} finally {
  await prisma.$disconnect();
}
