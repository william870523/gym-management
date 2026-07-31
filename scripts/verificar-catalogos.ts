/**
 * Verificación de catálogos — envoltorio MariaDB.
 * Gemela SQLite: `gym-local-api/scripts/verificar-catalogos.ts`.
 * La comparación vive en `scripts/verificar-catalogos.ts` (raíz del monorepo).
 */
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  imprimirVerificacion,
  verificarCatalogos,
} from "../../scripts/verificar-catalogos";

try {
  imprimirVerificacion(
    await verificarCatalogos(prisma, "MariaDB (gym-remote-api)"),
  );
} finally {
  await prisma.$disconnect();
}
