/**
 * M8 — liquidar el saldo entre sedes (docs/MULTI_SEDE.md §5.4).
 *
 * M4b dejó registrado quién le debe a quién: cuando el efectivo entra en una
 * caja y el ingreso es de otro, nace un saldo. §5.4 dice que registrarlo bien es
 * lo que no se puede posponer, y que **mover el dinero de verdad es un proceso
 * aparte y posterior**. Esto es ese proceso.
 *
 * ## Liquidar es anotar, nunca reescribir
 *
 * El saldo no se guarda en ninguna parte: se suma leyendo el libro de asientos.
 * Esa decisión de M4b es la que hace que no pueda mentir —o el contraasiento
 * está o no está, y se ve quién lo puso—, y liquidar tiene que respetarla:
 * pagar una deuda **añade un asiento `DESHACE`**, no toca los que ya había.
 * Bajar un número guardado dejaría el libro y el saldo contando cosas distintas
 * el día que alguien reintentara una transferencia.
 *
 * ## Tres cosas que esta política impide
 *
 * - **Liquidar entre monedas.** Deber 300 CUP no se salda con 3 USD sin una
 *   tasa declarada, y aquí no hay ninguna. Dos monedas son dos deudas (§7.3).
 * - **Liquidar a varios acreedores de una vez.** «Pagué 500» sin decir a quién
 *   deja al libro repartiéndolo por su cuenta, y ese reparto es justamente la
 *   decisión que alguien tiene que tomar.
 * - **Pagar de más sin querer.** Transferir 500 donde se debían 300 es real y
 *   hay que poder registrarlo, pero también es lo que pasa cuando alguien teclea
 *   un cero de más. Se acepta solo si quien lo hace lo **declara**; si no, se
 *   rechaza diciendo cuánto se debía.
 */

/** A quién se le paga. Igual que en el libro: la cadena no es una sede más. */
export type AcreedorDelSaldo =
  | { readonly tipo: "SEDE"; readonly gymId: string }
  | { readonly tipo: "CADENA" };

/** Una línea del saldo, tal y como la publica el libro de asientos. */
export interface LineaDeSaldoPendiente {
  readonly acreedor: AcreedorDelSaldo;
  readonly monedaId: string;
  /** Lo que se debe, como texto decimal. Negativo = ya se pagó de más. */
  readonly saldo: string;
}

export interface LiquidacionPedida {
  readonly deudorGymId: string;
  readonly acreedor: AcreedorDelSaldo;
  readonly monedaId: string;
  /** Importe a liquidar, texto decimal positivo. */
  readonly monto: string;
  /**
   * Quien paga declara que sabe que va a dejar saldo a favor. Sin esto, pagar
   * de más se rechaza: es el error de tecleo más fácil de cometer y el más
   * difícil de ver después, porque el saldo queda negativo y parece un abono.
   */
  readonly aceptaDejarSaldoAFavor?: boolean;
}

export interface LiquidacionResuelta {
  readonly deudorGymId: string;
  readonly acreedor: AcreedorDelSaldo;
  readonly monedaId: string;
  /** Lo que se debía antes de esta liquidación. */
  readonly saldoAntes: string;
  readonly monto: string;
  readonly saldoDespues: string;
  /** Salda la deuda entera y no deja nada pendiente. */
  readonly liquidaDeltodo: boolean;
  /** Deja saldo a favor del deudor: pagó más de lo que debía. */
  readonly dejaSaldoAFavor: boolean;
}

export class LiquidacionSaldoError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

/** Clave de un acreedor, para agrupar sin confundir la cadena con una sede. */
export function claveDeAcreedor(acreedor: AcreedorDelSaldo): string {
  return acreedor.tipo === "CADENA" ? "CADENA" : `SEDE:${acreedor.gymId}`;
}

/**
 * Importes en unidades mínimas.
 *
 * El dinero viaja como texto de punta a punta (MONEY-01) y se suma en enteros:
 * en coma flotante, a partir de cierto volumen de asientos se pierden centavos,
 * y un saldo entre sedes es exactamente donde eso acaba en una discusión.
 */
export function aMinimas(valor: unknown): bigint {
  const texto = String(valor ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(texto)) {
    throw new LiquidacionSaldoError(`Importe no válido: «${texto}».`);
  }
  const negativo = texto.startsWith("-");
  const [entera, decimal = ""] = texto.replace("-", "").split(".");
  const centavos = `${decimal}00`.slice(0, 2);
  const total = BigInt(entera) * 100n + BigInt(centavos);
  return negativo ? -total : total;
}

export function aTexto(minimas: bigint): string {
  const negativo = minimas < 0n;
  const absoluto = negativo ? -minimas : minimas;
  return `${negativo ? "-" : ""}${absoluto / 100n}.${(absoluto % 100n)
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Comprueba la liquidación contra el saldo real y devuelve cómo queda.
 *
 * No escribe nada: decide. Quien la llame anotará el asiento `DESHACE` con este
 * resultado delante.
 */
export function resolverLiquidacion(input: {
  readonly pedida: LiquidacionPedida;
  readonly saldos: readonly LineaDeSaldoPendiente[];
}): LiquidacionResuelta {
  const { pedida } = input;
  const deudor = String(pedida.deudorGymId ?? "").trim();
  if (!deudor) throw new LiquidacionSaldoError("Falta la sede que paga.");
  const monedaId = String(pedida.monedaId ?? "").trim();
  if (!monedaId) {
    // Sin moneda no se sabe qué deuda se está pagando, y elegirla por defecto
    // es como se acaba saldando la equivocada.
    throw new LiquidacionSaldoError("Falta la moneda de la liquidación.");
  }
  if (pedida.acreedor.tipo === "SEDE" && !String(pedida.acreedor.gymId ?? "").trim()) {
    throw new LiquidacionSaldoError("Falta la sede a la que se paga.");
  }
  if (pedida.acreedor.tipo === "SEDE" && pedida.acreedor.gymId === deudor) {
    // Una sede no se debe a sí misma; si aparece, es un error de datos y
    // dejarlo pasar generaría un asiento que nadie sabría interpretar.
    throw new LiquidacionSaldoError("Una sede no se liquida a sí misma.");
  }

  const monto = aMinimas(pedida.monto);
  if (monto <= 0n) {
    throw new LiquidacionSaldoError("La liquidación tiene que ser un importe positivo.");
  }

  const clave = claveDeAcreedor(pedida.acreedor);
  const linea = input.saldos.find(
    (fila) => claveDeAcreedor(fila.acreedor) === clave && fila.monedaId === monedaId,
  );
  const saldoAntes = linea ? aMinimas(linea.saldo) : 0n;

  if (saldoAntes <= 0n) {
    throw new LiquidacionSaldoError(
      saldoAntes === 0n
        ? "No hay saldo pendiente con ese acreedor en esa moneda."
        : `Esa deuda ya está pagada de más en ${aTexto(-saldoAntes)}.`,
      409,
    );
  }

  const saldoDespues = saldoAntes - monto;
  if (saldoDespues < 0n && pedida.aceptaDejarSaldoAFavor !== true) {
    throw new LiquidacionSaldoError(
      `Se deben ${aTexto(saldoAntes)} y se intentan liquidar ${aTexto(monto)}. ` +
        "Si el pago de más es intencionado, hay que declararlo.",
      409,
    );
  }

  return {
    deudorGymId: deudor,
    acreedor: pedida.acreedor,
    monedaId,
    saldoAntes: aTexto(saldoAntes),
    monto: aTexto(monto),
    saldoDespues: aTexto(saldoDespues),
    liquidaDeltodo: saldoDespues === 0n,
    dejaSaldoAFavor: saldoDespues < 0n,
  };
}

/**
 * Lo que queda por liquidar de una sede, ya filtrado.
 *
 * Solo las líneas con deuda viva: enseñar las que están a cero llena la pantalla
 * de acreedores con los que no hay nada que hacer, y esconde las que sí.
 */
export function pendientesDeLiquidar(
  saldos: readonly LineaDeSaldoPendiente[],
): LineaDeSaldoPendiente[] {
  return saldos.filter((linea) => aMinimas(linea.saldo) > 0n);
}
