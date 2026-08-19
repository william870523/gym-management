/**
 * M6 — el detalle de cobros de una sede, visto desde el central
 * (docs/MULTI_SEDE.md §6.4).
 *
 * §6.4 lo describe como «los mismos informes que ve la sede, en solo lectura»,
 * para «revisar, auditar, buscar un cobro concreto». Es la vista que se abre
 * cuando el consolidado enseña una cifra rara y alguien quiere saber de dónde
 * sale.
 *
 * ## La pregunta que hay que hacerse antes de listar nada
 *
 * «Los cobros de la sede B» son **dos listas distintas** desde M4c, y quien las
 * confunda audita mal:
 *
 * - los cobros cuyo **ingreso** es de B —su socio, su plan, su servicio—, que
 *   son los que suman en su resultado y en el consolidado;
 * - los cobros cuyo **efectivo** entró en la caja de B, que son los que tiene
 *   que cuadrar en su arqueo.
 *
 * Casi siempre coinciden. No coinciden en el cobro cruzado: un socio de Centro
 * paga en Oeste, y ese cobro es **ingreso de Centro** y **efectivo de Oeste**.
 *
 * Mirar solo `gym_id` deja fuera de la lista de Oeste un cobro que Oeste tiene
 * delante, en su caja, y quien audite su arqueo no lo encontrará. Mirar solo
 * dónde se cobró le atribuye a Oeste un ingreso que no es suyo, que es el error
 * que §7.10 llama el más caro. Por eso cada cobro entra **clasificado**, y los
 * totales van separados.
 *
 * ## De dónde salen los datos, y por qué se dice
 *
 * Si el período está cerrado, el detalle sale del **cierre firmado**: es lo que
 * la sede firmó, y auditar contra otra cosa sería auditar contra una cifra que
 * nadie aprobó. Si no lo está —o si el cierre es mensual, cuyo snapshot no
 * guarda el detalle de pagos—, sale de lo vivo y **se declara**, porque un
 * listado en vivo cambia mañana y quien lo imprima tiene que saberlo.
 */

/** Qué es ese cobro **para la sede que se está mirando**. */
export type ClaseDeCobro = "INGRESO_Y_EFECTIVO" | "SOLO_INGRESO" | "SOLO_EFECTIVO";

/** De dónde sale el listado. Lo mira quien decide si puede firmar algo con él. */
export type OrigenDelDetalle = "CIERRE_FIRMADO" | "EN_VIVO";

export interface CobroParaDetalle {
  readonly pagoClienteId: string;
  readonly monedaId: string;
  /** Importe cobrado en unidades menores. */
  readonly montoMenor: number;
  /** Sede **dueña del ingreso**. */
  readonly gymId: string;
  /**
   * Sede en cuya caja entró el efectivo, cuando no es la misma. Nulo en el
   * cobro corriente, donde las dos coinciden (M4c).
   */
  readonly cobradoEnGymId?: string | null;
  readonly anulado?: boolean;
}

export interface CobroClasificado extends CobroParaDetalle {
  readonly clase: ClaseDeCobro;
}

export interface TotalDeMoneda {
  readonly monedaId: string;
  /** Lo que la sede ganó: cobros cuyo ingreso es suyo, anulados aparte. */
  readonly ingresoMenor: number;
  /** Lo que pasó por su caja, sea suyo el ingreso o no. */
  readonly efectivoMenor: number;
  /** De ese efectivo, lo que es de otro y tendrá que liquidar. */
  readonly cobradoPorCuentaAjenaMenor: number;
  readonly cobros: number;
  readonly anulados: number;
}

const entero = (valor: unknown) => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

const texto = (valor: unknown) => String(valor ?? "").trim();

/**
 * Qué es un cobro para la sede que se mira.
 *
 * `cobradoEnGymId` nulo significa «se cobró donde se ingresa», que es el caso
 * corriente; tratarlo como «no se cobró en ninguna parte» dejaría todos los
 * cobros normales fuera del arqueo.
 */
export function clasificarCobro(cobro: CobroParaDetalle, gymId: string): ClaseDeCobro | null {
  const sede = texto(gymId);
  const dueña = texto(cobro.gymId);
  const caja = texto(cobro.cobradoEnGymId) || dueña;
  const esIngreso = dueña === sede;
  const esEfectivo = caja === sede;
  if (esIngreso && esEfectivo) return "INGRESO_Y_EFECTIVO";
  if (esIngreso) return "SOLO_INGRESO";
  if (esEfectivo) return "SOLO_EFECTIVO";
  // Ni suyo ni cobrado allí: no es de esta sede y no entra en su detalle.
  return null;
}

/** Los cobros que le tocan a esa sede, cada uno con lo que es para ella. */
export function detalleDeLaSede(
  cobros: readonly CobroParaDetalle[],
  gymId: string,
): CobroClasificado[] {
  const filas: CobroClasificado[] = [];
  for (const cobro of cobros) {
    const clase = clasificarCobro(cobro, gymId);
    if (clase) filas.push({ ...cobro, clase });
  }
  return filas;
}

/**
 * Totales por moneda, con el ingreso y el efectivo separados.
 *
 * Nunca se suman monedas distintas, aquí tampoco: cada una tiene su fila. Y los
 * anulados no restan del ingreso ni del efectivo —salen contados aparte—,
 * porque el detalle es para **buscar** un cobro, y uno anulado que desapareciera
 * de la lista es justo el que alguien está buscando.
 */
export function totalesDelDetalle(filas: readonly CobroClasificado[]): TotalDeMoneda[] {
  const porMoneda = new Map<string, {
    ingreso: number; efectivo: number; ajeno: number; cobros: number; anulados: number;
  }>();
  for (const fila of filas) {
    const monedaId = texto(fila.monedaId);
    if (!monedaId) continue;
    const total = porMoneda.get(monedaId) ??
      { ingreso: 0, efectivo: 0, ajeno: 0, cobros: 0, anulados: 0 };
    total.cobros += 1;
    if (fila.anulado) {
      total.anulados += 1;
    } else {
      const monto = entero(fila.montoMenor);
      if (fila.clase !== "SOLO_EFECTIVO") total.ingreso += monto;
      if (fila.clase !== "SOLO_INGRESO") total.efectivo += monto;
      if (fila.clase === "SOLO_EFECTIVO") total.ajeno += monto;
    }
    porMoneda.set(monedaId, total);
  }
  return [...porMoneda.entries()]
    .sort(([izquierda], [derecha]) => izquierda.localeCompare(derecha))
    .map(([monedaId, total]) => ({
      monedaId,
      ingresoMenor: total.ingreso,
      efectivoMenor: total.efectivo,
      cobradoPorCuentaAjenaMenor: total.ajeno,
      cobros: total.cobros,
      anulados: total.anulados,
    }));
}

/**
 * Qué advertir según de dónde salga el listado.
 *
 * Un detalle en vivo cambia mañana; uno firmado no. Quien lo imprima para
 * discutir una cifra tiene que saber cuál está mirando.
 */
export function notaDelOrigen(origen: OrigenDelDetalle): string {
  return origen === "CIERRE_FIRMADO"
    ? "Sale del cierre que la sede firmó: no cambia."
    : "El período no tiene cierre firmado con detalle: esto es lo que hay ahora y puede cambiar.";
}
