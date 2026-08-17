/**
 * Retira las copias de visitante cuyo acceso multi-sede ya no cubre
 * (docs/MULTI_SEDE.md §9-bis).
 *
 * Sin `--aplicar` **solo informa**: ejecuta el mismo camino y deshace la
 * transacción. Con `--aplicar` escribe y emite la baja para todas las sedes.
 *
 *   bun run barrer:visitantes            # qué haría
 *   bun run barrer:visitantes --aplicar  # hacerlo
 */
import { prisma } from "../src/infrastructure/db/prismaClient";
import { barrerVisitantesCaducados } from "../src/application/acceso-multisede/barrido-visitantes";

const aplicar = process.argv.includes("--aplicar");
// `--al-dia=2026-10-01` evalúa la caducidad a esa fecha, para responder
// «¿a quién le caduca el plus ese día?» sin esperar a que llegue.
const alDiaArg = process.argv
  .find((a) => a.startsWith("--al-dia="))
  ?.split("=")[1];
const alDia = alDiaArg ? new Date(`${alDiaArg}T12:00:00.000Z`) : undefined;
if (alDia && Number.isNaN(alDia.getTime())) {
  throw new Error("--al-dia espera una fecha AAAA-MM-DD.");
}

try {
  const resultado = await barrerVisitantesCaducados({ aplicar, alDia });
  const verbo = resultado.aplicado ? "retiradas" : "se retirarían";
  console.log(
    `Barrido de copias de visitante${alDia ? ` al ${alDiaArg}` : ""} · ` +
      `revisadas ${resultado.revisadas} · ` +
      `${verbo} ${resultado.retiradas.length}`,
  );
  for (const ci of resultado.retiradas) console.log(`   ${ci}`);
  if (!resultado.aplicado && resultado.retiradas.length > 0) {
    console.log("\nNada se ha escrito. Repite con --aplicar para hacerlo.");
  }
} finally {
  await prisma.$disconnect();
}
