/**
 * M5 — el semáforo de cierre por sede (docs/MULTI_SEDE.md §6.2).
 *
 * Contabilidad central **pide** el cierre de un período; cada sede lo **ejecuta
 * y lo firma** con su arqueo físico, porque el dinero está allí. El semáforo es
 * lo que el central mira para saber si puede consolidar.
 *
 * ## La corrección que este fichero introduce, y por qué
 *
 * §6.2 lista cuatro estados y uno de ellos, «CERRADA SIN SINCRONIZAR», el
 * central **no puede observarlo**: si el cierre no ha llegado, no ha llegado, y
 * desde aquí eso es indistinguible de que la sede no haya cerrado. Publicarlo
 * como si se supiera sería inventar una certeza.
 *
 * Lo que sí se puede saber es **cuándo se supo por última vez de esa sede**. Así
 * que la ausencia de cierre se parte en dos, que es la distinción que de verdad
 * cambia lo que hace el administrador:
 *
 * - `SIN_CERRAR` — la sede está al habla y no ha cerrado. Se le reclama.
 * - `SIN_NOTICIAS` — lleva sin sincronizar más de lo tolerable, así que puede
 *   haber cerrado sin que lo sepamos. No se le reclama: se mira por qué está
 *   incomunicada.
 *
 * Tratarlas igual es el error caro: el consolidado se firmaría creyendo que una
 * sede no cerró cuando lo que pasa es que nadie ha hablado con ella.
 */

/** Estados que el central puede **demostrar**, no suponer. */
export type EstadoSemaforo =
  | "CERRADA_Y_SINCRONIZADA"
  | "CON_INCIDENCIAS"
  | "SIN_CERRAR"
  | "SIN_NOTICIAS";

/**
 * Diferencia de arqueo **de una moneda**, en unidades menores.
 *
 * Va por moneda y no como un total porque el descuadre es dinero, y aquí rige
 * la regla dura de siempre: **nunca se suman monedas distintas**. Un total
 * mezclado no solo sería una cifra sin significado; podría **cancelarse** —+350
 * en una moneda y −350 en otra dan cero— y pintar de verde una sede que tiene
 * dos cajas descuadradas. El semáforo declararía consolidable justo el caso que
 * existe para detectar.
 */
export interface DescuadreDeMoneda {
  readonly monedaId: string;
  readonly menor: number;
}

export interface CierreDeSede {
  /** `CERRADO` es el único que cuenta: `ABIERTO` y `REABIERTO` no consolidan. */
  readonly estado: string;
  /** Diferencias de arqueo sin justificar, una por moneda. */
  readonly descuadres?: readonly DescuadreDeMoneda[] | null;
  /** Movimientos del período que siguen sin conciliar. */
  readonly movimientosPendientes?: number | null;
}

export interface EntradaDelSemaforo {
  readonly gymId: string;
  /** El cierre firmado de esa sede para el período pedido, si llegó. */
  readonly cierre?: CierreDeSede | null;
  /** Última vez que esa instalación habló con el concentrador. */
  readonly ultimaSincronizacion?: Date | null;
  readonly ahora: Date;
  /**
   * A partir de cuántas horas de silencio se deja de reclamar y se pasa a
   * mirar la conexión. Por defecto 24: una sede que cierra a diario y lleva más
   * de un día muda no es una sede morosa, es una sede incomunicada.
   */
  readonly horasDeSilencioTolerables?: number;
}

export interface FilaDelSemaforo {
  readonly gymId: string;
  readonly estado: EstadoSemaforo;
  /** Verde solo si consolida sin nota al pie. */
  readonly consolidable: boolean;
  readonly motivo: string;
}

const HORAS_POR_DEFECTO = 24;
const entero = (valor: unknown) => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** Las que de verdad descuadran, cada una con su moneda delante. */
export function descuadresVivos(
  descuadres: readonly DescuadreDeMoneda[] | null | undefined,
): DescuadreDeMoneda[] {
  return (descuadres ?? [])
    .map((d) => ({ monedaId: String(d?.monedaId ?? "").trim(), menor: entero(d?.menor) }))
    .filter((d) => d.menor !== 0);
}

export function estadoDeLaSede(entrada: EntradaDelSemaforo): FilaDelSemaforo {
  const gymId = String(entrada.gymId ?? "").trim();
  const cierre = entrada.cierre ?? null;

  if (cierre && cierre.estado === "CERRADO") {
    const descuadres = descuadresVivos(cierre.descuadres);
    const pendientes = entero(cierre.movimientosPendientes);
    if (descuadres.length > 0 || pendientes > 0) {
      // Cerró, así que el dinero está contado; pero consolidarla sin decirlo
      // metería su diferencia en el total de la cadena sin que nadie la vea.
      const partes = [
        descuadres.length > 0
          ? `descuadre de arqueo (${descuadres
              .map((d) => `${d.monedaId || "sin moneda"} ${d.menor}`)
              .join(", ")})`
          : null,
        pendientes > 0 ? `${pendientes} movimiento(s) sin conciliar` : null,
      ].filter(Boolean);
      return {
        gymId,
        estado: "CON_INCIDENCIAS",
        consolidable: false,
        motivo: `Cerró con ${partes.join(" y ")}.`,
      };
    }
    return {
      gymId,
      estado: "CERRADA_Y_SINCRONIZADA",
      consolidable: true,
      motivo: "Cerró y su cierre está aquí.",
    };
  }

  // Sin cierre a la vista. La pregunta que decide qué hacer no es «¿cerró?»
  // —eso ya se sabe que no consta— sino «¿sabemos algo de esta sede?».
  const silencioTolerable =
    (entrada.horasDeSilencioTolerables ?? HORAS_POR_DEFECTO) * 3_600_000;
  const ultima = entrada.ultimaSincronizacion ?? null;
  const silencio = ultima
    ? entrada.ahora.getTime() - ultima.getTime()
    : Number.POSITIVE_INFINITY;

  if (silencio > silencioTolerable) {
    return {
      gymId,
      estado: "SIN_NOTICIAS",
      consolidable: false,
      motivo: ultima
        ? `Sin sincronizar desde ${ultima.toISOString()}: puede haber cerrado sin que conste aquí.`
        : "Nunca ha sincronizado: no se puede afirmar que no haya cerrado.",
    };
  }

  return {
    gymId,
    estado: "SIN_CERRAR",
    consolidable: false,
    motivo: "Está al habla y su cierre no consta: falta que lo firme.",
  };
}

export interface Consolidado {
  readonly filas: readonly FilaDelSemaforo[];
  /** Solo se firma en verde; si no, hay que declarar las ausentes. */
  readonly puedeFirmarse: boolean;
  /** Sedes que quedarían fuera, para nombrarlas en un cierre parcial. */
  readonly ausentes: readonly string[];
}

/**
 * El estado de la cadena entera.
 *
 * `puedeFirmarse` es falso mientras alguna sede no esté en verde, y las que
 * falten salen **nombradas**: §6.2 lo pide así porque un total silencioso e
 * incompleto es peor que no tener total. Si el dueño firma igual, firma un
 * cierre parcial declarado, y para declararlo necesita esta lista.
 */
export function consolidarSemaforo(
  entradas: readonly EntradaDelSemaforo[],
): Consolidado {
  const filas = entradas.map(estadoDeLaSede);
  const ausentes = filas.filter((f) => !f.consolidable).map((f) => f.gymId);
  return { filas, puedeFirmarse: ausentes.length === 0, ausentes };
}
