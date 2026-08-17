/**
 * Quién se queda el dinero y quién se queda el ingreso (M4b,
 * docs/MULTI_SEDE.md §5.1, §5.3 y §5.4).
 *
 * Hasta aquí las dos cosas eran la misma: quien cobraba, ingresaba. El acceso
 * multi-sede las separa, y el documento lo llama «el riesgo contable más caro»
 * (§7.10): si un cobro hecho en la sede B para una membresía de A se registra
 * como ingreso de B, el margen de B se infla con dinero que no ganó, el de A
 * queda corto como si el socio no hubiera pagado, y el consolidado cuenta el
 * mismo dinero dos veces.
 *
 * La regla es una sola frase: **el efectivo es de la caja donde entró; el
 * ingreso es de quien presta el servicio.** De ahí sale un saldo, y el saldo es
 * lo único que hay que registrar bien desde el primer cobro; liquidarlo —mover
 * el dinero de verdad— es un proceso posterior y aparte (§5.4).
 *
 * Esto es una función pura y vive en el dominio a propósito: es la misma
 * decisión en el escritorio y en el concentrador, y una prueba de la raíz
 * compara los dos ficheros byte a byte. Que las dos superficies clasifiquen
 * distinto un mismo cobro no daría error en ninguna parte: daría dos
 * contabilidades que no cuadran, y cada base habría guardado fielmente su
 * propia versión.
 */

/**
 * A quién pertenece un ingreso.
 *
 * `CADENA` no es una sede con `gym_id`: es el titular de los ingresos que no
 * son de ninguna sede. Modelarlo como una sede más obligaría a inventarle una
 * fila en `gym` y a acordarse de excluirla de todos los informes por sede.
 */
export type TitularDeIngreso =
  | { readonly tipo: "SEDE"; readonly gymId: string }
  | { readonly tipo: "CADENA" };

/**
 * Qué se está cobrando. No es el catálogo de productos: son las dos formas de
 * pertenencia que existen hoy, y de ellas sale toda la decisión.
 */
export type ClaseDeCobro =
  /** Plan o cuota de una membresía. El ingreso es de la sede que la aloja. */
  | "PLAN"
  /** El plus multi-sede. El ingreso es de la cadena, siempre (§5.1). */
  | "PLUS_MULTISEDE";

/** `origen_tipo` del movimiento de tesorería cuando el cobro es propio. */
export const ORIGEN_TESORERIA_COBRO_PROPIO = "PAGO_CLIENTE";

/**
 * `origen_tipo` del movimiento cuando el efectivo entró aquí pero el ingreso es
 * de otro. Es una familia nueva, y no un `PAGO_CLIENTE` con una bandera al
 * lado, porque los cuatro cierres y el margen agrupan por `origen_tipo`: dejarlo
 * dentro de la familia de siempre haría que sumaran solos, que es exactamente
 * la avería que se quiere impedir.
 */
export const ORIGEN_TESORERIA_COBRO_AJENO = "COBRO_CUENTA_AJENA";

/**
 * Si el asiento crea la deuda o la deshace.
 *
 * Va en el propio saldo, y no como un parámetro suelto de quien lo escribe,
 * porque anular un cobro por cuenta ajena toca **dos cajas y dos
 * contabilidades** (§7.8): un reverso que devuelva el dinero y olvide el saldo
 * deja a la sede debiendo para siempre algo que ya devolvió.
 */
export type SentidoDeSaldo = "GENERA" | "DESHACE";

/** Lo que la sede que cobró le debe a otro por ese cobro. */
export type SaldoDeEnlace = {
  /** Sede en cuya caja quedó el efectivo. Es la que debe. */
  readonly deudorGymId: string;
  /** Quien tiene el ingreso y aún no tiene el dinero. */
  readonly acreedor: TitularDeIngreso;
  readonly sentido: SentidoDeSaldo;
};

export type DecisionDeCobro = {
  /** A quién se le atribuye el ingreso. */
  readonly ingreso: TitularDeIngreso;
  /** En qué caja entró el efectivo. Siempre una sede: el dinero es físico. */
  readonly efectivoEnGymId: string;
  /** `true` cuando el efectivo y el ingreso no acaban en el mismo sitio. */
  readonly porCuentaAjena: boolean;
  /** Nulo cuando el cobro es propio y no queda nada pendiente entre partes. */
  readonly saldo: SaldoDeEnlace | null;
  /** Cómo debe clasificarse el movimiento de tesorería que se genere. */
  readonly origenTesoreria: string;
};

const limpio = (valor: unknown): string => String(valor ?? "").trim();

/**
 * Decide, para un cobro concreto, dónde va el dinero y dónde va el ingreso.
 *
 * Falla cerrado: sin sede identificada no hay decisión posible, y adivinarla
 * es justamente lo que produce el ingreso mal atribuido.
 */
export function decidirCobro(input: {
  clase: ClaseDeCobro;
  /** Sede que atiende el mostrador: donde entra el efectivo. */
  gymIdQueCobra: unknown;
  /** Sede dueña de la membresía del socio. */
  gymIdDelSocio: unknown;
}): DecisionDeCobro {
  const queCobra = limpio(input.gymIdQueCobra);
  const delSocio = limpio(input.gymIdDelSocio);
  if (!queCobra) {
    throw new Error("El cobro no identifica la sede en cuya caja entra el dinero.");
  }
  if (!delSocio) {
    throw new Error("El cobro no identifica la sede dueña de la membresía.");
  }

  // El plus no es ingreso de ninguna sede, ni siquiera de la del propio socio
  // cuando se le cobra en su casa. Ese matiz es el que más se olvida: como el
  // caso corriente es «cobro en mi sede a mi socio», es tentador tratarlo como
  // ingreso propio y dejar el saldo solo para el visitante. Sería contar como
  // margen de la sede un dinero que es de la cadena.
  const ingreso: TitularDeIngreso =
    input.clase === "PLUS_MULTISEDE"
      ? { tipo: "CADENA" }
      : { tipo: "SEDE", gymId: delSocio };

  const porCuentaAjena =
    ingreso.tipo === "CADENA" ? true : ingreso.gymId !== queCobra;

  return {
    ingreso,
    efectivoEnGymId: queCobra,
    porCuentaAjena,
    saldo: porCuentaAjena
      ? { deudorGymId: queCobra, acreedor: ingreso, sentido: "GENERA" }
      : null,
    origenTesoreria: porCuentaAjena
      ? ORIGEN_TESORERIA_COBRO_AJENO
      : ORIGEN_TESORERIA_COBRO_PROPIO,
  };
}

/** El plus multi-sede nunca es ingreso de una sede. Atajo con nombre. */
export function esIngresoDeLaCadena(decision: DecisionDeCobro): boolean {
  return decision.ingreso.tipo === "CADENA";
}

/**
 * Dos titulares son el mismo. Se necesita para netear el saldo y para no
 * duplicar la línea de un acreedor en los informes.
 */
export function mismoTitular(a: TitularDeIngreso, b: TitularDeIngreso): boolean {
  if (a.tipo === "CADENA" || b.tipo === "CADENA") return a.tipo === b.tipo;
  return a.gymId === b.gymId;
}

/** Clave estable del acreedor, para agrupar saldos sin repetir el `if`. */
export function claveDeTitular(titular: TitularDeIngreso): string {
  return titular.tipo === "CADENA" ? "CADENA" : `SEDE:${titular.gymId}`;
}

export const MOTIVO_SIN_PLUS_NO_PAGA_FUERA =
  "El socio no tiene acceso multi-sede vigente, así que solo puede pagar en su sede.";

/**
 * ¿Puede esta sede cobrarle a este socio? (decisión del dueño, 17-08-2026)
 *
 * El plus da acceso a entrenar en otra sede, y con él llega también el derecho
 * a pagar allí. Sin plus, no: «si Pedro pertenece a Oeste y no tiene el plus,
 * no puede ir a Norte a pagar». Podría parecer inofensivo aceptarle el dinero
 * —es dinero, y la mecánica del saldo ya existiría—, pero para cobrarle habría
 * que saber qué plan tiene y cuánto debe, y esos datos solo viajan a otra sede
 * para quien tiene el plus. Sin la regla, la puerta quedaría abierta y el dato
 * no estaría, que es la peor de las dos combinaciones.
 *
 * Falla cerrado: ante la duda, se cobra en su sede.
 */
export function puedeCobrarEnEstaSede(input: {
  gymIdQueCobra: unknown;
  gymIdDelSocio: unknown;
  /** El plus del socio, activo y cubriendo la fecha de negocio de hoy. */
  accesoMultisedeVigente: boolean;
}): { permitido: boolean; motivo?: string } {
  const queCobra = limpio(input.gymIdQueCobra);
  const delSocio = limpio(input.gymIdDelSocio);
  if (!queCobra || !delSocio) {
    return { permitido: false, motivo: MOTIVO_SIN_PLUS_NO_PAGA_FUERA };
  }
  if (queCobra === delSocio) return { permitido: true };
  return input.accesoMultisedeVigente === true
    ? { permitido: true }
    : { permitido: false, motivo: MOTIVO_SIN_PLUS_NO_PAGA_FUERA };
}

/**
 * La decisión del reverso de un cobro, derivada de la del cobro.
 *
 * Se deriva y no se vuelve a decidir a propósito: recalcularla desde los datos
 * de hoy daría otra respuesta el día que el socio haya cambiado de sede o su
 * plus haya caducado entre el cobro y la anulación, y el contraasiento iría a
 * parar a otra parte que el asiento original. Un reverso tiene que deshacer
 * exactamente lo que se hizo, no lo que hoy parecería correcto.
 */
export function reversoDe(decision: DecisionDeCobro): DecisionDeCobro {
  return {
    ...decision,
    saldo: decision.saldo ? { ...decision.saldo, sentido: "DESHACE" } : null,
  };
}
