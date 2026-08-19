/**
 * M6 — de un cierre firmado a un aporte del consolidado (§6.3).
 *
 * El consolidado **agrega lo que ya se firmó**, y lo firmado son dos cosas con
 * forma distinta:
 *
 * - **Certificado por período** (`tesoreria_cierre_periodo.snapshot_json`): trae
 *   `resumen_monedas[]`, y cada moneda ya lleva `cobro_neto` y
 *   `cobrado_cuenta_ajena_neto` calculados y congelados.
 * - **Cierre mensual formal** (`tesoreria_cierre_mensual.resumen_snapshot_json`):
 *   trae `resultado_operativo.monedas[]`, donde lo mismo vive en el bloque
 *   `caja`: `cobros_brutos`, `cambio_entregado_neto`, `anulaciones_netas` y
 *   `cobrado_por_cuenta_ajena`.
 *
 * Traducir aquí, y no en la política, es a propósito: la política no debe
 * conocer la forma de dos snapshots que evolucionan por su cuenta, y este
 * fichero no debe decidir nada sobre monedas ni sobre doble conteo.
 *
 * ## Lo que un snapshot no trae, se declara
 *
 * `cobrado_por_cuenta_ajena` existe desde M4b. Un cierre firmado **antes** no lo
 * lleva, y ahí hay dos maneras de equivocarse:
 *
 * - tomarlo como `0` —y entonces el consolidado afirma que esa sede no cobró
 *   nada por cuenta de otra, que es una afirmación que nadie hizo—;
 * - tomarlo como el ingreso —y contar dos veces el mismo dinero—.
 *
 * Así que ninguna de las dos: el aporte entra con el ingreso que sí consta y el
 * traductor devuelve un **aviso** diciendo que la separación no estaba en ese
 * cierre. El consolidado se puede firmar, pero enseñando la advertencia. La
 * diferencia entre «no cobró nada ajeno» y «este cierre no lo distinguía» es
 * justo la que un certificado no puede borrar.
 */
import { decimalToUnits } from "../../domain/money";
import type { AporteDeSede } from "../../domain/consolidado-cadena-policy";

export interface TraduccionDeCierre {
  readonly aportes: readonly AporteDeSede[];
  /** Lo que este cierre no puede afirmar, en palabras y con su sede delante. */
  readonly avisos: readonly string[];
  /**
   * Código de cada moneda **tal y como se congeló en el cierre**, no como se
   * llame hoy en el catálogo.
   *
   * Un informe que enseñe `1dbc5b00-…` en vez de `CUP` no lo puede leer nadie, y
   * resolver el código contra el catálogo actual tampoco sirve: si alguien
   * renombra una moneda, el certificado de julio pasaría a decir otra cosa. El
   * cierre ya lo guardó; se usa el suyo.
   */
  readonly codigos: Readonly<Record<string, string>>;
}

const VACIA: TraduccionDeCierre = { aportes: [], avisos: [], codigos: {} };

/** Unidades menores desde el texto decimal del snapshot; `null` si no viene. */
function menor(valor: unknown): number | null {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  if (!texto) return null;
  try {
    return Number(decimalToUnits(texto as never));
  } catch {
    return null;
  }
}

function parsear(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parseado = JSON.parse(json);
    return parseado && typeof parseado === "object" ? parseado : null;
  } catch {
    return null;
  }
}

/**
 * Aporte desde el certificado por período.
 *
 * `cobro_neto` es el ingreso de la sede: bruto menos el cambio entregado y las
 * anulaciones. El cobro por cuenta ajena **no** está dentro —su movimiento nace
 * con `origen_tipo` propio y el resumen lo saca a su propia línea—, así que
 * sumar los dos aquí sería el doble conteo que §6.3 prohíbe.
 */
export function aporteDesdeCierrePeriodo(input: {
  readonly gymId: string;
  readonly snapshotJson: string | null | undefined;
}): TraduccionDeCierre {
  const snapshot = parsear(input.snapshotJson);
  if (!snapshot) {
    return {
      aportes: [],
      avisos: [`${input.gymId}: su certificado por período no se puede leer.`],
      codigos: {},
    };
  }
  const monedas = Array.isArray(snapshot.resumen_monedas) ? snapshot.resumen_monedas : [];
  const aportes: AporteDeSede[] = [];
  const avisos: string[] = [];
  const codigos: Record<string, string> = {};
  for (const fila of monedas as Array<Record<string, unknown>>) {
    const monedaId = String(fila.moneda_id ?? "").trim();
    if (!monedaId) continue;
    const ingreso = menor(fila.cobro_neto);
    if (ingreso === null) {
      avisos.push(
        `${input.gymId}: el certificado no declara cobro neto en ${monedaId}; ` +
          "esa moneda queda fuera del consolidado.",
      );
      continue;
    }
    const codigo = String(fila.codigo ?? "").trim();
    if (codigo) codigos[monedaId] = codigo;
    const ajeno = menor(fila.cobrado_cuenta_ajena_neto);
    if (ajeno === null) {
      avisos.push(
        `${input.gymId}: este cierre es anterior a la separación del dinero ` +
          `cobrado por cuenta ajena (${codigo || monedaId}); no se puede afirmar ` +
          "que fuera cero.",
      );
    }
    aportes.push({
      gymId: input.gymId,
      monedaId,
      ingresoMenor: ingreso,
      cobradoPorCuentaAjenaMenor: ajeno ?? 0,
      origenCierre: "PERIODO",
    });
  }
  if (aportes.length === 0 && avisos.length === 0) {
    avisos.push(`${input.gymId}: su certificado por período no trae ninguna moneda.`);
  }
  return { aportes, avisos, codigos };
}

/**
 * Aporte desde el cierre mensual formal.
 *
 * Aquí el ingreso hay que rearmarlo: `cobros_brutos` menos el cambio entregado y
 * las anulaciones, que el bloque `caja` publica ya en positivo. Es la misma
 * cuenta que el certificado por período congela como `cobro_neto`, y se hace así
 * —y no con `flujo_operativo`— porque aquel incluye pagos a entrenadores,
 * reembolsos y gastos, que no son ingreso sino lo que se hizo con él.
 */
export function aporteDesdeCierreMensual(input: {
  readonly gymId: string;
  readonly snapshotJson: string | null | undefined;
}): TraduccionDeCierre {
  const snapshot = parsear(input.snapshotJson);
  if (!snapshot) {
    return {
      aportes: [],
      avisos: [`${input.gymId}: su cierre mensual no se puede leer.`],
      codigos: {},
    };
  }
  const operativo = snapshot.resultado_operativo as Record<string, unknown> | undefined;
  const monedas = Array.isArray(operativo?.monedas) ? operativo!.monedas : [];
  if (monedas.length === 0) {
    return {
      aportes: [],
      avisos: [
        `${input.gymId}: su cierre mensual no trae resultado operativo por moneda ` +
          "(firmado antes de que existiera); no se puede consolidar sin recalcularlo.",
      ],
      codigos: {},
    };
  }
  const aportes: AporteDeSede[] = [];
  const avisos: string[] = [];
  const codigos: Record<string, string> = {};
  for (const fila of monedas as Array<Record<string, unknown>>) {
    const monedaId = String(fila.moneda_id ?? "").trim();
    if (!monedaId) continue;
    const codigo = String(fila.moneda_codigo ?? "").trim();
    if (codigo) codigos[monedaId] = codigo;
    const caja = (fila.caja ?? {}) as Record<string, unknown>;
    const brutos = menor(caja.cobros_brutos);
    if (brutos === null) {
      avisos.push(
        `${input.gymId}: el cierre mensual no declara cobros brutos en ${monedaId}; ` +
          "esa moneda queda fuera del consolidado.",
      );
      continue;
    }
    const cambio = menor(caja.cambio_entregado_neto) ?? 0;
    const anulaciones = menor(caja.anulaciones_netas) ?? 0;
    const ajeno = menor(caja.cobrado_por_cuenta_ajena);
    if (ajeno === null) {
      avisos.push(
        `${input.gymId}: este cierre mensual es anterior a la separación del dinero ` +
          `cobrado por cuenta ajena (${codigo || monedaId}); no se puede afirmar ` +
          "que fuera cero.",
      );
    }
    aportes.push({
      gymId: input.gymId,
      monedaId,
      ingresoMenor: brutos - cambio - anulaciones,
      cobradoPorCuentaAjenaMenor: ajeno ?? 0,
      origenCierre: "MENSUAL",
    });
  }
  return { aportes, avisos, codigos };
}

/** Junta traducciones conservando el orden y sin perder ningún aviso. */
export function unirTraducciones(
  traducciones: readonly TraduccionDeCierre[],
): TraduccionDeCierre {
  if (traducciones.length === 0) return VACIA;
  return {
    aportes: traducciones.flatMap((t) => t.aportes),
    avisos: traducciones.flatMap((t) => t.avisos),
    codigos: Object.assign({}, ...traducciones.map((t) => t.codigos)),
  };
}
