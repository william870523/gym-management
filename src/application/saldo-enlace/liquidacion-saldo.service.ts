/**
 * M8 — registrar que una sede **pagó** lo que debía (docs/MULTI_SEDE.md §5.4).
 *
 * M4b dejó anotado quién le debe a quién; §5.4 dice que mover el dinero de
 * verdad es un proceso aparte, y este servicio es ese proceso. Quien decide si
 * la liquidación es legítima es `liquidacion-saldo-policy`; aquí solo se
 * escribe lo que aquella autorizó.
 *
 * ## Dos filas, y ninguna sobra
 *
 * Una liquidación deja **un asiento `DESHACE`** en el libro —que es lo que baja
 * el saldo, porque el saldo no se guarda: se suma— y **una fila propia** con lo
 * que el asiento no sabe decir: quién la registró, con qué referencia de
 * transferencia, y cuánto se debía antes y después.
 *
 * Podría parecer que la fila sobra, ya que el asiento mueve el dinero. No sobra:
 * el asiento del libro **no lleva autor**. Nació de un cobro, donde el autor ya
 * estaba en el cobro. Una transferencia entre dos negocios sin nadie que
 * responda por ella es exactamente la clase de apunte que nadie puede aclarar
 * seis meses después, y `saldo_antes`/`saldo_despues` guardan lo que se creía en
 * ese momento: si mañana aparece un cobro atrasado con fecha vieja, el saldo
 * recalculado cambia y esa foto es lo único que explica por qué se transfirió
 * esa cifra y no otra.
 *
 * ## De quién es la fila
 *
 * De la sede **deudora**, igual que el asiento: es la que sacó el dinero de su
 * caja y la que tiene que cuadrarla. La acreedora no la descarga —su ingreso ya
 * lo tenía contado desde el cobro; lo que le llega es dinero, no contabilidad
 * nueva— y ve la liquidación desde el concentrador, que es quien arbitra entre
 * las dos.
 *
 * Gemelo byte a byte entre las dos APIs. Que difirieran no daría error en
 * ninguna parte: daría dos contabilidades que no cuadran mientras la huella de
 * paridad dice que todo está bien, porque cada base habría guardado fielmente su
 * propia versión.
 */
import type { SaldoDeEnlace } from "../../domain/cobro-por-cuenta-ajena-policy";
import {
  aMinimas,
  aTexto,
  LiquidacionSaldoError,
  resolverLiquidacion,
  type AcreedorDelSaldo,
  type LiquidacionPedida,
  type LiquidacionResuelta,
} from "../../domain/liquidacion-saldo-policy";
import { anotarAsiento, saldoDeLaSede } from "./saldo-enlace.service";

/** Por qué nace un asiento, no qué se cobró. Ver la nota de la migración. */
export const CLASE_LIQUIDACION = "LIQUIDACION";
export const ORIGEN_LIQUIDACION = "LIQUIDACION_SALDO";

/** Quien registra la liquidación, congelado en la fila. */
export interface ActorDeLaLiquidacion {
  readonly userId: string;
  readonly nombre: string;
  readonly rol: string;
}

export interface LiquidacionAnotada extends LiquidacionPedida {
  /**
   * La pone quien llama. No se deriva del saldo a propósito: pagar dos veces
   * 100 de una deuda de 300 son **dos** liquidaciones legítimas, y un
   * identificador derivado las fundiría en una sola.
   */
  readonly liquidacionId: string;
  /** Referencia de la transferencia: número de operación, comprobante, lo que haya. */
  readonly referencia?: string | null;
  readonly nota?: string | null;
  /** Fecha de negocio de la sede que paga, no la del servidor. */
  readonly fechaNegocio: Date;
  readonly sourceDevice?: string | null;
}

function texto(valor: unknown, limite: number): string | null {
  const limpio = String(valor ?? "").trim();
  return limpio ? limpio.slice(0, limite) : null;
}

/**
 * Anota la liquidación y su asiento, o devuelve la que ya estaba.
 *
 * Devolver la existente en vez de fallar es lo que permite reintentar sin miedo
 * cuando la respuesta se pierde por el camino. Sin esto, el recepcionista que no
 * vio la confirmación vuelve a darle al botón y la sede acaba habiendo
 * «liquidado» el doble de lo que transfirió.
 */
export async function registrarLiquidacion(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly tx: any;
  readonly pedida: LiquidacionAnotada;
  readonly actor: ActorDeLaLiquidacion;
  readonly nowUtc: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly emitirAsiento: (fila: any) => Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly emitirLiquidacion: (fila: any) => Promise<unknown>;
}): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly liquidacion: any;
  readonly resuelta: LiquidacionResuelta;
  readonly yaEstaba: boolean;
}> {
  const { tx, pedida, actor, nowUtc } = input;
  const liquidacionId = String(pedida.liquidacionId ?? "").trim();
  if (!liquidacionId) {
    throw new LiquidacionSaldoError("Falta el identificador de la liquidación.");
  }
  if (!String(actor.userId ?? "").trim()) {
    // Sin autor no se registra: es dinero entre dos negocios.
    throw new LiquidacionSaldoError("No se pudo identificar quién registra la liquidación.", 401);
  }

  const yaEstaba = await tx.saldoLiquidacion.findFirst({
    where: { liquidacion_id: liquidacionId },
  });
  if (yaEstaba) {
    // Los importes se vuelven a formatear en vez de devolverse tal cual salen de
    // la base. Prisma entrega el `Decimal` como «550», sin decimales, así que la
    // primera respuesta decía «550.00» y el reintento «550»: la misma
    // liquidación contestando dos textos distintos según cuántas veces se
    // hubiera pulsado el botón.
    const saldoDespues = aMinimas(String(yaEstaba.saldo_despues));
    return {
      liquidacion: yaEstaba,
      resuelta: {
        deudorGymId: String(yaEstaba.gym_id),
        acreedor: acreedorDeLaFila(yaEstaba),
        monedaId: String(yaEstaba.moneda_id),
        saldoAntes: aTexto(aMinimas(String(yaEstaba.saldo_antes))),
        monto: aTexto(aMinimas(String(yaEstaba.monto))),
        saldoDespues: aTexto(saldoDespues),
        liquidaDeltodo: saldoDespues === 0n,
        dejaSaldoAFavor: saldoDespues < 0n,
      },
      yaEstaba: true,
    };
  }

  // El saldo se lee **dentro** de la transacción y justo antes de escribir: leer
  // fuera dejaría una ventana en la que otro pago cambia la deuda y esta
  // liquidación la deja negativa sin que nadie lo haya declarado.
  const saldos = await saldoDeLaSede({ tx, gymId: pedida.deudorGymId });
  const resuelta = resolverLiquidacion({ pedida, saldos });

  const saldo: SaldoDeEnlace = {
    deudorGymId: resuelta.deudorGymId,
    acreedor: resuelta.acreedor,
    sentido: "DESHACE",
  };
  const asiento = await anotarAsiento({
    tx,
    nowUtc,
    asiento: {
      asientoId: `sae-liq-${liquidacionId}`,
      saldo,
      monedaId: resuelta.monedaId,
      monto: resuelta.monto,
      origenTipo: ORIGEN_LIQUIDACION,
      origenId: liquidacionId,
      claveOrigen: `LIQUIDACION:${liquidacionId}`,
      claseCobro: CLASE_LIQUIDACION,
      ci: null,
      ocurridoAt: nowUtc,
      fechaNegocio: pedida.fechaNegocio,
      sourceDevice: pedida.sourceDevice ?? null,
    },
    emitirEvento: input.emitirAsiento,
  });

  const liquidacion = await tx.saldoLiquidacion.create({
    data: {
      liquidacion_id: liquidacionId,
      gym_id: resuelta.deudorGymId,
      acreedor_tipo: resuelta.acreedor.tipo,
      acreedor_gym_id:
        resuelta.acreedor.tipo === "SEDE" ? resuelta.acreedor.gymId : null,
      moneda_id: resuelta.monedaId,
      monto: resuelta.monto,
      saldo_antes: resuelta.saldoAntes,
      saldo_despues: resuelta.saldoDespues,
      dejo_saldo_a_favor: resuelta.dejaSaldoAFavor,
      asiento_id: String(asiento.asiento_id),
      referencia: texto(pedida.referencia, 191),
      nota: texto(pedida.nota, 500),
      registrado_por_user_id: actor.userId,
      registrado_por_nombre_snapshot: actor.nombre,
      registrado_por_rol_snapshot: actor.rol,
      ocurrido_at: nowUtc,
      fecha_negocio: pedida.fechaNegocio,
      source_device: pedida.sourceDevice ?? null,
      version: 1,
      is_deleted: false,
      created_at: nowUtc,
      updated_at: nowUtc,
      deleted_at: null,
    },
  });
  await input.emitirLiquidacion(liquidacion);

  return { liquidacion, resuelta, yaEstaba: false };
}

/** Reconstruye el acreedor de una fila guardada. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function acreedorDeLaFila(fila: any): AcreedorDelSaldo {
  return String(fila.acreedor_tipo) === "CADENA"
    ? { tipo: "CADENA" }
    : { tipo: "SEDE", gymId: String(fila.acreedor_gym_id ?? "") };
}

/** Las liquidaciones de una sede, de la más reciente a la más antigua. */
export async function liquidacionesDeLaSede(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly tx: any;
  readonly gymId: string;
  readonly limite?: number;
}) {
  const filas = await input.tx.saldoLiquidacion.findMany({
    where: { gym_id: input.gymId, is_deleted: false },
    orderBy: [{ ocurrido_at: "desc" }, { liquidacion_id: "desc" }],
    take: Math.min(Math.max(Number(input.limite ?? 100) || 100, 1), 500),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return filas.map((fila: any) => ({
    liquidacion_id: String(fila.liquidacion_id),
    gym_id: String(fila.gym_id),
    acreedor: acreedorDeLaFila(fila),
    moneda_id: String(fila.moneda_id),
    // Mismo motivo que arriba: el `Decimal` de la base llega sin decimales.
    monto: aTexto(aMinimas(String(fila.monto))),
    saldo_antes: aTexto(aMinimas(String(fila.saldo_antes))),
    saldo_despues: aTexto(aMinimas(String(fila.saldo_despues))),
    dejo_saldo_a_favor: Boolean(fila.dejo_saldo_a_favor),
    asiento_id: String(fila.asiento_id),
    referencia: fila.referencia ?? null,
    nota: fila.nota ?? null,
    registrado_por: {
      user_id: String(fila.registrado_por_user_id),
      nombre: String(fila.registrado_por_nombre_snapshot),
      rol: String(fila.registrado_por_rol_snapshot),
    },
    ocurrido_at: fila.ocurrido_at,
    fecha_negocio: fila.fecha_negocio,
  }));
}
