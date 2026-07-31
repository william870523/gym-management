/**
 * Auditoría SOLO LECTURA de la cobertura de fecha de nacimiento (E0).
 *
 * Responde dos preguntas antes de decidir nada:
 *   1. ¿cuántos socios tienen ya fecha, por tipo de documento?
 *   2. ¿cuántos de los que NO la tienen llevan en su `ci` un carné cubano
 *      estructuralmente válido, es decir, cuánta historia se está quedando
 *      fuera sólo porque el tipo de documento dice otra cosa?
 *
 * No escribe absolutamente nada. Es la fotografía que justifica —o no—
 * reclasificar el padrón.
 */
import { analizarCubaCi } from "../src/application/clients/cuba-ci";
import { trustedClock } from "../src/config/trusted-clock";
import { prisma } from "../src/infrastructure/db/prismaClient";

const TIPOS_DEL_CONTRATO = ["CI_CUBANO", "PASAPORTE", "OTRO", "DESCONOCIDO"];

async function auditar() {
  const referencia = trustedClock.nowUtc();
  const filas = await prisma.$queryRawUnsafe<
    Array<{
      ci: string;
      tipo: string | null;
      sexo: string | null;
      // El motor devuelve el CASE como BigInt: comparar con === 1 daría falso.
      tiene_fecha: bigint | number;
    }>
  >(
    "SELECT ci, tipo_documento AS tipo, sexo, " +
      "CASE WHEN fecha_nacimiento IS NULL THEN 0 ELSE 1 END AS tiene_fecha " +
      "FROM cliente WHERE is_deleted = 0",
  );

  interface Bucket {
    total: number;
    conFecha: number;
    ciValido: number;
    sexoDiscrepante: number;
    noDerivable: Map<string, number>;
  }
  const porTipo = new Map<string, Bucket>();
  const tiposFueraDeContrato = new Set<string>();

  for (const fila of filas) {
    const tipo = fila.tipo ?? "(null)";
    if (!TIPOS_DEL_CONTRATO.includes(tipo)) tiposFueraDeContrato.add(tipo);
    if (!porTipo.has(tipo)) {
      porTipo.set(tipo, {
        total: 0,
        conFecha: 0,
        ciValido: 0,
        sexoDiscrepante: 0,
        noDerivable: new Map(),
      });
    }
    const bucket = porTipo.get(tipo)!;
    bucket.total += 1;
    if (Number(fila.tiene_fecha) === 1) bucket.conFecha += 1;

    const analisis = analizarCubaCi(fila.ci, { fechaReferencia: referencia });
    if (analisis.estado === "valido") {
      bucket.ciValido += 1;
      const declarado = (fila.sexo ?? "").trim().toLowerCase();
      const codificado = analisis.sexoCodificado;
      if (declarado.length > 0 && codificado !== null) {
        const coincide = declarado.startsWith(
          codificado === "masculino" ? "m" : "f",
        );
        if (!coincide) bucket.sexoDiscrepante += 1;
      }
    } else {
      const motivo =
        analisis.errores.map((error) => error.codigo).join("+") ||
        analisis.estado;
      bucket.noDerivable.set(motivo, (bucket.noDerivable.get(motivo) ?? 0) + 1);
    }
  }

  console.log("Cobertura de fecha de nacimiento por tipo de documento\n");
  console.log(
    "tipo".padEnd(16) +
      "total".padStart(7) +
      "con fecha".padStart(11) +
      "CI válido".padStart(11) +
      "derivables".padStart(12),
  );
  let derivablesTotal = 0;
  for (const [tipo, datos] of [...porTipo.entries()].sort()) {
    const derivables = Math.max(0, datos.ciValido - datos.conFecha);
    derivablesTotal += derivables;
    console.log(
      tipo.padEnd(16) +
        String(datos.total).padStart(7) +
        String(datos.conFecha).padStart(11) +
        String(datos.ciValido).padStart(11) +
        String(derivables).padStart(12),
    );
    for (const [motivo, n] of [...datos.noDerivable.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)) {
      console.log(`${"".padEnd(18)}${String(n).padStart(5)} × ${motivo}`);
    }
    if (datos.sexoDiscrepante > 0) {
      console.log(
        `${"".padEnd(18)}${String(datos.sexoDiscrepante).padStart(5)} × ` +
          `sexo declarado ≠ dígito 10 del CI`,
      );
    }
  }

  console.log(
    `\nSocios cuya fecha se podría derivar hoy y no está escrita: ` +
      `${derivablesTotal}.`,
  );
  if (tiposFueraDeContrato.size > 0) {
    console.log(
      `\nAVISO: hay tipos de documento fuera del contrato ` +
        `(${[...tiposFueraDeContrato].join(", ")}). El contrato admite ` +
        `${TIPOS_DEL_CONTRATO.join(", ")}. Esas filas no las escribe la ` +
        `aplicación: vienen de datos anteriores a la validación.`,
    );
  }
}

try {
  await auditar();
} finally {
  await prisma.$disconnect();
}
