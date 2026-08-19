/**
 * M6 — el consolidado de la cadena (docs/MULTI_SEDE.md §6.3).
 *
 * Agrega los cierres que **ya firmó** cada sede. No los recalcula: §6.3 lo
 * prohíbe, y con razón —recalcular sobre datos que siguen llegando daría un
 * total distinto cada vez que alguien lo mirara, y ninguno coincidiría con lo
 * que la sede firmó—.
 *
 * ## La trampa que este fichero existe para hacer imposible
 *
 * §6.3 lo dice en una línea: «separa el ingreso propio de cada sede del dinero
 * cobrado por cuenta ajena; si se mezclan, el consolidado cuenta dos veces el
 * mismo dinero». Conviene entender por qué, porque el error es fácil y la cifra
 * resultante parece razonable.
 *
 * Cuando un socio de Centro paga en Oeste (M4b/M4c), ese dinero deja **dos
 * rastros**:
 *
 * - en **Oeste**, efectivo en la caja: está allí, entra en su arqueo, y de él
 *   sale una deuda —«efectivo aquí, ingreso allá»—;
 * - en **Centro**, ingreso: es su socio, su plan, su servicio.
 *
 * Son el mismo billete visto dos veces. Sumar «lo que entró en cada caja» para
 * sacar el ingreso de la cadena lo cuenta doble. Y sumar solo los ingresos deja
 * el efectivo sin cuadrar. Las dos lecturas son legítimas y **no son la misma
 * cifra**, así que aquí viajan separadas y con nombre:
 *
 * - `ingresoMenor` — de quién es el servicio. Es lo que suma la cadena.
 * - `cobradoPorCuentaAjenaMenor` — efectivo que está en esa caja y **no** es
 *   suyo. Nunca entra en el ingreso; sale en su propia línea porque de ella
 *   nace un saldo que alguien va a reclamar.
 *
 * ## Y nunca entre monedas
 *
 * La regla dura de siempre: no se suman monedas distintas. Aquí no es solo que
 * el total sea una cifra sin significado; es que se **cancela**. El consolidado
 * se publica por moneda, en bloques, y no hay ningún campo donde quepa un total
 * general. Si hiciera falta uno, tendría que pasar por una tasa declarada y con
 * fecha, y eso es otra decisión y otro documento.
 */

/** Un cierre firmado, reducido a lo que el consolidado necesita de él. */
export interface AporteDeSede {
  readonly gymId: string;
  readonly monedaId: string;
  /**
   * Ingreso **de esa sede** en el período, en unidades menores: lo que cobró
   * por su propio servicio. El plus multi-sede no entra aquí —es de la cadena—
   * y tampoco el plan de un socio de otra sede.
   */
  readonly ingresoMenor: number;
  /**
   * Efectivo que entró en su caja y cuyo ingreso es de otro (§5.3). Cuenta en su
   * arqueo y **no** en el ingreso de nadie más que su dueño.
   */
  readonly cobradoPorCuentaAjenaMenor?: number | null;
  /** De qué cierre sale: el mensual formal o el certificado por período. */
  readonly origenCierre: "MENSUAL" | "PERIODO";
}

/** Una sede que no consolida, con su nombre, para poder declararla. */
export interface SedeAusente {
  readonly gymId: string;
  readonly motivo: string;
}

export interface AportePublicado {
  readonly gymId: string;
  readonly ingresoMenor: number;
  readonly cobradoPorCuentaAjenaMenor: number;
  readonly origenCierre: "MENSUAL" | "PERIODO";
}

export interface BloqueDeMoneda {
  readonly monedaId: string;
  /** Ingreso de la cadena en esa moneda: la suma de los ingresos propios. */
  readonly ingresoMenor: number;
  /**
   * Efectivo cobrado por cuenta de otro, sumado aparte. **No** está dentro de
   * `ingresoMenor`: sumarlo allí contaría dos veces el mismo dinero.
   */
  readonly cobradoPorCuentaAjenaMenor: number;
  /** Siempre el desglose por sede, nunca solo el total (§6.3). */
  readonly sedes: readonly AportePublicado[];
}

export type ClaseDeConsolidado = "COMPLETO" | "PARCIAL_DECLARADO";

export interface Consolidado {
  readonly clase: ClaseDeConsolidado;
  readonly monedas: readonly BloqueDeMoneda[];
  /**
   * Las sedes que quedan fuera, **nombradas**. §6.2 punto 5: si el dueño firma
   * con alguna ausente, firma un cierre parcial declarado. Nunca un total
   * silencioso e incompleto.
   */
  readonly ausentes: readonly SedeAusente[];
  /**
   * Cuántas **sedes** entraron, no cuántas líneas.
   *
   * Se cuenta por sede a propósito: una sede con dos monedas produce dos
   * aportes, y contarlos diría «2 cierres incluidos» donde hay uno. Sobre esa
   * cifra se decide si hay algo que congelar, así que confundirla haría creer
   * que el consolidado abarca más sedes de las que abarca.
   */
  readonly sedesIncluidas: number;
}

export class ConsolidadoCadenaError extends Error {}

const entero = (valor: unknown) => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * El consolidado del período.
 *
 * Se le pasan los aportes de los cierres firmados y las sedes que no
 * consolidan; devuelve un bloque por moneda con su desglose, y declara si es
 * completo o parcial. La clase **no** se elige: sale de si hay ausentes.
 */
export function consolidarCadena(input: {
  readonly aportes: readonly AporteDeSede[];
  readonly ausentes?: readonly SedeAusente[];
}): Consolidado {
  const ausentes = (input.ausentes ?? []).map((sede) => ({
    gymId: String(sede.gymId ?? "").trim(),
    motivo: String(sede.motivo ?? "").trim() || "sin motivo declarado",
  }));

  const porMoneda = new Map<string, Map<string, AportePublicado>>();
  for (const aporte of input.aportes) {
    const monedaId = String(aporte.monedaId ?? "").trim();
    const gymId = String(aporte.gymId ?? "").trim();
    if (!monedaId) {
      // Sin moneda no se puede agregar sin mezclar, y mezclar es justo lo que
      // este fichero existe para impedir. Falla cerrado.
      throw new ConsolidadoCadenaError(
        `El aporte de ${gymId || "una sede sin identificar"} no declara moneda.`,
      );
    }
    if (!gymId) {
      throw new ConsolidadoCadenaError("Hay un aporte sin sede: no se puede desglosar.");
    }
    const bloque = porMoneda.get(monedaId) ?? new Map<string, AportePublicado>();
    if (bloque.has(gymId)) {
      // Dos aportes de la misma sede y moneda serían el mismo período contado
      // dos veces —el caso típico: un cierre y su reapertura, o el mensual y el
      // certificado por período del mismo mes—. Sumarlos duplicaría el ingreso.
      throw new ConsolidadoCadenaError(
        `${gymId} aporta dos veces en ${monedaId}: el período se contaría doble.`,
      );
    }
    bloque.set(gymId, {
      gymId,
      ingresoMenor: entero(aporte.ingresoMenor),
      cobradoPorCuentaAjenaMenor: entero(aporte.cobradoPorCuentaAjenaMenor),
      origenCierre: aporte.origenCierre,
    });
    porMoneda.set(monedaId, bloque);
  }

  const monedas = [...porMoneda.entries()]
    .sort(([izquierda], [derecha]) => izquierda.localeCompare(derecha))
    .map(([monedaId, bloque]) => {
      const sedes = [...bloque.values()].sort((a, b) => a.gymId.localeCompare(b.gymId));
      return {
        monedaId,
        ingresoMenor: sedes.reduce((suma, sede) => suma + sede.ingresoMenor, 0),
        cobradoPorCuentaAjenaMenor: sedes.reduce(
          (suma, sede) => suma + sede.cobradoPorCuentaAjenaMenor,
          0,
        ),
        sedes,
      };
    });

  const sedes = new Set(monedas.flatMap((bloque) => bloque.sedes.map((sede) => sede.gymId)));
  return {
    clase: ausentes.length === 0 ? "COMPLETO" : "PARCIAL_DECLARADO",
    monedas,
    ausentes,
    sedesIncluidas: sedes.size,
  };
}

/**
 * Si el consolidado se puede firmar, y si no, por qué.
 *
 * Un parcial **sí** se puede firmar —§6.2 lo permite— pero solo declarando a
 * quién deja fuera, y eso es precisamente lo que el consolidado ya trae. Lo que
 * no se firma nunca es un consolidado **vacío**: un certificado sin un solo
 * cierre dentro no congela nada y después parecería que el período se cerró.
 */
export function motivoParaNoFirmar(consolidado: Consolidado): string | null {
  if (consolidado.sedesIncluidas === 0) {
    return "Ninguna sede ha firmado su cierre: no hay nada que congelar.";
  }
  if (consolidado.monedas.length === 0) {
    return "Los cierres incluidos no traen ninguna moneda con movimiento.";
  }
  return null;
}
