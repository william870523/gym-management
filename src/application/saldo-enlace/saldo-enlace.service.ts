/**
 * Escribir asientos del saldo entre partes y leer el saldo que resulta
 * (M4b, docs/MULTI_SEDE.md §5.4).
 *
 * **El saldo no se guarda: se suma.** Un número guardado se descuadra en
 * silencio el día que un reverso se aplique a medias, y nadie lo nota hasta
 * que alguien reclama dinero. Un libro de asientos no puede mentir así: o el
 * contraasiento está o no está, y se ve quién lo puso.
 *
 * Gemelo byte a byte entre las dos APIs, comparado por una prueba de la raíz.
 * Que el escritorio y el concentrador escribieran asientos distintos para el
 * mismo cobro no daría error en ninguna parte: daría dos contabilidades que no
 * cuadran, y la huella de paridad diría que todo está bien porque cada base
 * habría guardado fielmente su propia versión.
 *
 * El dinero se maneja como texto decimal de punta a punta (MONEY-01): sumar en
 * `number` a partir de cierto volumen de asientos empieza a perder centavos, y
 * un saldo entre sedes es exactamente donde eso acaba en una discusión.
 */
import {
  claveDeTitular,
  type SaldoDeEnlace,
  type TitularDeIngreso,
} from "../../domain/cobro-por-cuenta-ajena-policy";

/** Importe en unidades mínimas, para sumar sin coma flotante. */
function aMinimas(valor: unknown): bigint {
  const texto = String(valor ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(texto)) {
    throw new Error(`Importe no válido para un asiento de saldo: «${texto}».`);
  }
  const negativo = texto.startsWith("-");
  const [entera, decimal = ""] = texto.replace("-", "").split(".");
  const centavos = `${decimal}00`.slice(0, 2);
  const total = BigInt(entera) * 100n + BigInt(centavos);
  return negativo ? -total : total;
}

function aTexto(minimas: bigint): string {
  const negativo = minimas < 0n;
  const absoluto = negativo ? -minimas : minimas;
  const entera = absoluto / 100n;
  const resto = (absoluto % 100n).toString().padStart(2, "0");
  return `${negativo ? "-" : ""}${entera}.${resto}`;
}

export type AsientoNuevo = {
  /** Identidad del asiento. Determinista, la pone quien lo emite. */
  asientoId: string;
  /**
   * Quién debe, a quién y en qué sentido.
   *
   * Antes esto era la `DecisionDeCobro` entera, y el libro solo sabía anotar lo
   * que salía de un cobro. Liquidar una deuda (M8) también escribe aquí y no es
   * un cobro: no tiene ingreso que atribuir ni caja donde entre efectivo.
   * Pedirle esos campos habría obligado a inventarlos, y un asiento que miente
   * sobre su origen es peor que uno que no existe.
   */
  saldo: SaldoDeEnlace | null;
  monedaId: string;
  /** Importe positivo, como texto decimal. */
  monto: string;
  origenTipo: string;
  origenId: string;
  /** Idempotencia: el mismo cobro reintentado no duplica la deuda. */
  claveOrigen: string;
  claseCobro: string;
  ci?: string | null;
  ocurridoAt: Date;
  /** Fecha de negocio de la sede DEUDORA, no la del servidor. */
  fechaNegocio: Date;
  sourceDevice?: string | null;
};

/**
 * Escribe un asiento, o devuelve el que ya había con esa clave.
 *
 * Devolver el existente en vez de fallar es lo que permite que la cola
 * reintente sin miedo. Y no se actualiza: un asiento contable no se reescribe,
 * se contraasienta.
 *
 * `emitirEvento` es **obligatorio**, y esa es la única razón de que exista como
 * parámetro en vez de dejárselo a quien llama: «un dato sin su rastro, o un
 * rastro sin su dato, es una divergencia esperando turno». Cada API pasa el
 * suyo —la instalación encola en `sync_outbox`, el concentrador escribe en
 * `sync_log`— y así el fichero sigue siendo gemelo byte a byte. Solo se emite
 * cuando el asiento se escribe de verdad: repetir el evento de una fila que ya
 * estaba metería en la cola el alta de algo que existe.
 */
export async function anotarAsiento(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  asiento: AsientoNuevo;
  nowUtc: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  emitirEvento: (fila: any) => Promise<unknown>;
}) {
  const { tx, asiento, nowUtc } = input;
  const saldo = asiento.saldo;
  if (!saldo) {
    throw new Error(
      "Sin saldo no hay asiento: un cobro propio no genera deuda entre partes.",
    );
  }
  const minimas = aMinimas(asiento.monto);
  if (minimas <= 0n) {
    throw new Error("El importe de un asiento de saldo tiene que ser positivo.");
  }

  const existente = await tx.saldoEnlaceAsiento.findFirst({
    where: { gym_id: saldo.deudorGymId, clave_origen: asiento.claveOrigen },
  });
  if (existente) return existente;

  const creado = await tx.saldoEnlaceAsiento.create({
    data: {
      asiento_id: asiento.asientoId,
      gym_id: saldo.deudorGymId,
      acreedor_tipo: saldo.acreedor.tipo,
      acreedor_gym_id:
        saldo.acreedor.tipo === "SEDE" ? saldo.acreedor.gymId : null,
      moneda_id: asiento.monedaId,
      monto: aTexto(minimas),
      sentido: saldo.sentido,
      clase_cobro: asiento.claseCobro,
      origen_tipo: asiento.origenTipo,
      origen_id: asiento.origenId,
      clave_origen: asiento.claveOrigen,
      ci: asiento.ci ?? null,
      ocurrido_at: asiento.ocurridoAt,
      fecha_negocio: asiento.fechaNegocio,
      source_device: asiento.sourceDevice ?? null,
      version: 1,
      is_deleted: false,
      created_at: nowUtc,
      updated_at: nowUtc,
      deleted_at: null,
    },
  });
  await input.emitirEvento(creado);
  return creado;
}

export type LineaDeSaldo = {
  acreedor: TitularDeIngreso;
  monedaId: string;
  /** Lo que la sede debe, como texto decimal. Negativo = le sobra pagado. */
  saldo: string;
  /** Suma de lo generado y de lo deshecho, para poder cuadrar a mano. */
  generado: string;
  deshecho: string;
  asientos: number;
};

/**
 * Saldo de una sede, por acreedor y moneda.
 *
 * Se agrupa también por moneda a propósito: un total único mezclando monedas
 * es lo que §7.3 llama romper el consolidado. Dos monedas son dos deudas.
 */
export async function saldoDeLaSede(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;
  gymId: string;
  /** Opcional: corta el libro en una fecha de negocio, inclusive. */
  hastaFechaNegocio?: Date;
}): Promise<LineaDeSaldo[]> {
  const asientos = await input.tx.saldoEnlaceAsiento.findMany({
    where: {
      gym_id: input.gymId,
      is_deleted: false,
      ...(input.hastaFechaNegocio
        ? { fecha_negocio: { lte: input.hastaFechaNegocio } }
        : {}),
    },
  });

  const grupos = new Map<
    string,
    { acreedor: TitularDeIngreso; monedaId: string; generado: bigint; deshecho: bigint; asientos: number }
  >();

  for (const fila of asientos) {
    const acreedor: TitularDeIngreso =
      String(fila.acreedor_tipo) === "CADENA"
        ? { tipo: "CADENA" }
        : { tipo: "SEDE", gymId: String(fila.acreedor_gym_id ?? "") };
    const monedaId = String(fila.moneda_id);
    const clave = `${claveDeTitular(acreedor)}|${monedaId}`;
    const grupo =
      grupos.get(clave) ??
      { acreedor, monedaId, generado: 0n, deshecho: 0n, asientos: 0 };
    const minimas = aMinimas(fila.monto?.toString?.() ?? fila.monto);
    if (String(fila.sentido) === "DESHACE") grupo.deshecho += minimas;
    else grupo.generado += minimas;
    grupo.asientos += 1;
    grupos.set(clave, grupo);
  }

  return [...grupos.values()]
    .map((grupo) => ({
      acreedor: grupo.acreedor,
      monedaId: grupo.monedaId,
      saldo: aTexto(grupo.generado - grupo.deshecho),
      generado: aTexto(grupo.generado),
      deshecho: aTexto(grupo.deshecho),
      asientos: grupo.asientos,
    }))
    .sort((a, b) =>
      `${claveDeTitular(a.acreedor)}|${a.monedaId}`.localeCompare(
        `${claveDeTitular(b.acreedor)}|${b.monedaId}`,
      ),
    );
}

/** Utilidades expuestas para que las pruebas comparen sin duplicar la fórmula. */
export const dineroDelSaldo = { aMinimas, aTexto };
