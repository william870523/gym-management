/**
 * E0 — reclasificación del padrón por documento (docs/PLAN_ESTADISTICAS.md §7-bis).
 *
 * La migración de tipos documentales dejó como `DESCONOCIDO` a todo el padrón
 * heredado porque entonces no había con qué distinguir un carné cubano de
 * cualquier otro número. Ahora sí lo hay: el parser canónico, validado contra
 * `shared/cuba-ci/vectors.json`.
 *
 * Este script clasifica como `CI_CUBANO` a los socios cuyo `ci` es un carné
 * cubano **estructuralmente válido** (11 dígitos, fecha que existe, no futura,
 * edad admisible) y les deriva la fecha de nacimiento. Sin esto, la columna de
 * E0 nace vacía y no hay historia que graficar.
 *
 * Qué NO hace, a propósito:
 *   - no toca a quien ya está marcado PASAPORTE u OTRO: eso lo decidió una
 *     persona y un número de 11 dígitos no es motivo para contradecirla;
 *   - no corrige el sexo cuando discrepa del dígito 10, sólo lo informa: cuál
 *     de los dos está mal es una decisión humana;
 *   - no inventa fechas para lo que no parsea: eso queda `DESCONOCIDO` y sin
 *     fecha, que la estadística cuenta aparte.
 *
 * Por defecto hace SIMULACIÓN. Para escribir: `--aplicar`, que además exige un
 * dump previo en `CLIENT_BIRTHDATE_BACKUP_PATH`.
 * Gemelo SQLite: `gym-local-api/scripts/reclassify-cuban-ci.ts`.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { analizarCubaCi } from "../src/application/clients/cuba-ci";
import { trustedClock } from "../src/config/trusted-clock";
import { prisma } from "../src/infrastructure/db/prismaClient";

/** Tipos que este script puede reclasificar. El resto es decisión humana. */
const RECLASIFICABLES = new Set(["DESCONOCIDO", "CI", ""]);
const TIPOS_DEL_CONTRATO = ["CI_CUBANO", "PASAPORTE", "OTRO", "DESCONOCIDO"];

function exigirRespaldo() {
  const backupPath = process.env.CLIENT_BIRTHDATE_BACKUP_PATH;
  if (!backupPath || !existsSync(resolve(backupPath))) {
    throw new Error(
      "Defina CLIENT_BIRTHDATE_BACKUP_PATH con el dump MariaDB previo.",
    );
  }
  console.log(`Respaldo verificado: ${resolve(backupPath)}`);
}

async function ejecutar(aplicar: boolean) {
  const referencia = trustedClock.nowUtc();
  const filas = await prisma.$queryRawUnsafe<
    Array<{ ci: string; tipo: string | null; sexo: string | null }>
  >("SELECT ci, tipo_documento AS tipo, sexo FROM cliente WHERE is_deleted = 0");

  const aCubano: Array<{ ci: string; fecha: Date }> = [];
  const aDesconocido: Array<{ ci: string; motivo: string }> = [];
  const sexoDiscrepante: string[] = [];
  const sinDerivar = new Map<string, number>();
  let intactos = 0;

  for (const fila of filas) {
    const tipo = (fila.tipo ?? "").trim();
    if (!RECLASIFICABLES.has(tipo)) {
      intactos += 1;
      continue;
    }
    const analisis = analizarCubaCi(fila.ci, { fechaReferencia: referencia });
    if (analisis.estado === "valido" && analisis.fechaNacimiento !== null) {
      aCubano.push({ ci: fila.ci, fecha: analisis.fechaNacimiento });
      const declarado = (fila.sexo ?? "").trim().toLowerCase();
      const codificado = analisis.sexoCodificado;
      if (declarado.length > 0 && codificado !== null) {
        const coincide = declarado.startsWith(
          codificado === "masculino" ? "m" : "f",
        );
        if (!coincide) sexoDiscrepante.push(fila.ci);
      }
    } else {
      const motivo =
        analisis.errores.map((error) => error.codigo).join("+") ||
        analisis.estado;
      sinDerivar.set(motivo, (sinDerivar.get(motivo) ?? 0) + 1);
      if (!TIPOS_DEL_CONTRATO.includes(tipo)) {
        // Fuera del contrato y sin CI derivable: al menos entra en el contrato.
        aDesconocido.push({ ci: fila.ci, motivo });
      }
    }
  }
  const sinDerivarTotal = [...sinDerivar.values()].reduce((a, b) => a + b, 0);

  console.log(
    `${aplicar ? "APLICANDO" : "SIMULACIÓN (use --aplicar para escribir)"}\n`,
  );
  console.log(`Socios que pasan a CI_CUBANO con fecha derivada: ${aCubano.length}`);
  console.log(
    `Socios con tipo fuera del contrato que pasan a DESCONOCIDO: ` +
      `${aDesconocido.length}`,
  );
  console.log(`Socios que no se tocan (PASAPORTE/OTRO/CI_CUBANO ya fijados): ${intactos}`);
  console.log(
    `Socios que siguen DESCONOCIDO y SIN fecha (su número no es un CI ` +
      `derivable): ${sinDerivarTotal}`,
  );
  for (const [motivo, n] of [...sinDerivar.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${String(n).padStart(5)} × ${motivo}`);
  }
  console.log(
    `Suma de control: ${aCubano.length} + ${sinDerivarTotal} + ${intactos} = ` +
      `${aCubano.length + sinDerivarTotal + intactos} de ${filas.length} socios.`,
  );
  if (sexoDiscrepante.length > 0) {
    console.log(
      `\nAviso, NO se corrige: el sexo declarado no coincide con el dígito 10 ` +
        `del CI en ${sexoDiscrepante.length} socio(s). Se resuelve desde la ` +
        `ficha, uno a uno.`,
    );
  }
  for (const fila of aDesconocido.slice(0, 10)) {
    console.log(`  a DESCONOCIDO: ${fila.ci} — ${fila.motivo}`);
  }

  if (!aplicar) return;
  if (aCubano.length === 0 && aDesconocido.length === 0) {
    console.log("\nNada que escribir.");
    return;
  }

  exigirRespaldo();
  let escritos = 0;
  for (const fila of aCubano) {
    await prisma.cliente.update({
      where: { ci: fila.ci },
      data: { tipo_documento: "CI_CUBANO", fecha_nacimiento: fila.fecha },
    });
    escritos += 1;
  }
  for (const fila of aDesconocido) {
    await prisma.cliente.update({
      where: { ci: fila.ci },
      data: { tipo_documento: "DESCONOCIDO" },
    });
    escritos += 1;
  }
  console.log(`\nFilas escritas: ${escritos}.`);
}

const aplicar = process.argv.includes("--aplicar");
try {
  await ejecutar(aplicar);
} finally {
  await prisma.$disconnect();
}
