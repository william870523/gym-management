/**
 * Vaciado de la base — envoltorio MariaDB.
 *
 * Gemela SQLite: `gym-local-api/scripts/reset-base.ts`. La lógica y la lista
 * blanca viven en `scripts/reset-bases.ts` (raíz del monorepo) y son las mismas
 * para las dos bases; aquí solo se le da el cliente Prisma remoto y la forma
 * MariaDB de listar tablas y de suspender claves foráneas.
 *
 * Exige un dump previo en `RESET_BACKUP_PATH`, p. ej.:
 *   docker exec mariadb-hp mariadb-dump -u root -p... gym > dump.sql
 *
 * Uso:
 *   bun run reset:base -- --simular    (mide y explica, no borra)
 *   bun run reset:base -- --confirmar  (borra de verdad)
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  imprimirInformeReset,
  siguientePaso,
  vaciarBase,
  type AdaptadorReset,
} from "../../scripts/reset-bases";

const simular = !process.argv.includes("--confirmar");

const adaptador: AdaptadorReset = {
  nombre: "MariaDB (gym-remote-api)",
  citar: (identificador) => `\`${identificador.replaceAll("`", "``")}\``,
  async tablas() {
    const filas = await prisma.$queryRawUnsafe<Array<{ tabla: string }>>(
      "SELECT TABLE_NAME AS tabla FROM information_schema.TABLES " +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' " +
        "ORDER BY TABLE_NAME",
    );
    return filas.map((fila) => fila.tabla);
  },
  async suspenderClavesForaneas() {
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  },
  async restaurarClavesForaneas() {
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  },
};

if (!simular) {
  const respaldo = process.env.RESET_BACKUP_PATH;
  if (!respaldo || !existsSync(resolve(respaldo))) {
    throw new Error("Defina RESET_BACKUP_PATH con el dump MariaDB previo.");
  }
  console.log(`Respaldo declarado: ${resolve(respaldo)}`);
}

try {
  imprimirInformeReset(await vaciarBase(prisma, adaptador, { simular }));
  if (simular) {
    console.log(
      "\nEsto fue una simulación. Para borrar de verdad: " +
        "bun run reset:base -- --confirmar",
    );
  } else {
    console.log(`\n${siguientePaso()}`);
  }
} finally {
  await prisma.$disconnect();
}
