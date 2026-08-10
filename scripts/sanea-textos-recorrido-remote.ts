/**
 * Wrapper remoto del saneo de textos (corte 5b). Debe correr desde
 * gym-remote-api/ para que `@prisma/client` resuelva al cliente generado aquí.
 *   cd gym-remote-api && bun scripts/sanea-textos-recorrido-remote.ts [--dry]
 */
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  COLUMNAS_REMOTO,
  sanea,
} from "../../scripts/sanea-textos-recorrido";

const dry = process.argv.includes("--dry");
const total = await sanea(prisma as any, COLUMNAS_REMOTO, "remoto", dry);
await prisma.$disconnect();
process.exit(total >= 0 ? 0 : 1);
