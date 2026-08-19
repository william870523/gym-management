/**
 * Qué puede cobrarle una sede al socio de otra, y con qué (M4c,
 * docs/MULTI_SEDE.md §5.3).
 *
 * ## El problema que resuelve
 *
 * La sede visitada **no tiene los datos del socio**. M4a le replicó su
 * identidad y si su membresía está viva, y nada más: ni plan, ni precio, ni
 * historial. Con eso se le puede dejar entrar, pero no cobrarle.
 *
 * Y cobrarle tiene que poder hacerse **sin conexión**. Es la decisión del dueño
 * del 17-08-2026 y su razón es de mostrador: obligar a abrir la web dejaría al
 * socio esperando a que vuelva Internet, y pedirle que espere dos horas no es
 * una solución. Así que lo necesario para cobrar tiene que estar ya en la base
 * de la sede visitada antes de que el socio aparezca.
 *
 * ## Lo que viaja, y lo que deliberadamente no
 *
 * Viaja una **cotización**: el plan que tiene contratado, lo que le costaría
 * hoy con su descuento ya resuelto, hasta cuándo tiene cubierto y —si va por
 * cuotas— cuál le toca.
 *
 * **La mora viaja como REGLA, no como importe.** Es la decisión de diseño que
 * sostiene todo lo demás: el recargo es días de atraso × configuración del
 * plan, y las dos cosas están aquí, así que la sede visitada lo calcula bien en
 * el momento de cobrar aunque la cotización tenga tres semanas. Mandarlo ya
 * sumado la haría caducar en veinticuatro horas y obligaría a refrescarla a
 * diario contra el remoto, que es justo lo que no se puede exigir.
 *
 * **El descuento sí viaja resuelto**, y por lo contrario: depende de la
 * configuración de la sede DUEÑA —su porcentaje global, sus excepciones— y esa
 * configuración no se replica ni debe. Quien la tiene es quien la aplica.
 *
 * No viaja nada más: ni pagos, ni deudas históricas, ni entrenador. «Lleva a la
 * persona, no su caja», como dice el productor de la copia de visitante.
 *
 * ## Se envejece a la vista
 *
 * Una cotización es una foto y puede quedarse vieja —el socio pagó en su sede,
 * renovó, o le cambiaron el plan—. No se puede impedir sin conexión; lo que sí
 * se puede es **decirlo**: `calculada_al` viaja con ella y quien la lee sabe de
 * cuándo es. Fingir que está fresca sería peor que enseñar su fecha.
 *
 * Función pura y gemela byte a byte entre las dos APIs: es la misma cuenta en
 * el escritorio y en el concentrador, y una prueba de la raíz compara los dos
 * ficheros. Que difirieran daría dos importes distintos para el mismo socio sin
 * que ninguna base se quejara.
 */
import {
  decimalToUnits,
  normalizeMoney,
  unitsToDecimal,
  type DecimalInput,
} from "./money";

/** Configuración de recargo por mora del plan, tal y como viaja. */
export type MoraDeLaVisita = {
  readonly activo: boolean;
  /** `FIJO` | `PORCENTAJE`, con la misma semántica de docs/RECARGO_MORA.md. */
  readonly modo: string | null;
  readonly valor: string | null;
  readonly tope: string | null;
};

/** La cuota que toca, cuando la membresía va por cuotas. */
export type CuotaDeLaVisita = {
  readonly numero: number;
  readonly importe: string;
  /** Desde este día cuenta el atraso. */
  readonly fechaExigible: Date;
};

/**
 * Foto de lo que la sede visitada necesita para cobrarle a un socio ajeno.
 *
 * Todos los importes son texto decimal exacto (MONEY-01).
 */
export type CotizacionDeVisita = {
  readonly ci: string;
  /** Sede dueña del socio: a ella pertenece el ingreso. */
  readonly gymIdOrigen: string;
  readonly planId: string;
  readonly planCodigo: string;
  readonly planNombre: string;
  readonly monedaId: string;
  /** Precio de lista, antes del descuento del socio. */
  readonly precioLista: string;
  /** Precio ya con su descuento aplicado por la sede dueña. */
  readonly precioFinal: string;
  readonly categoriaCliente: string;
  /** Fin de cobertura EXCLUSIVO: ese día ya no cubre. Mide el atraso. */
  readonly cubreHasta: Date | null;
  readonly mora: MoraDeLaVisita | null;
  readonly cuota: CuotaDeLaVisita | null;
  /** Cuándo la calculó la sede dueña. Se enseña; no se disimula. */
  readonly calculadaAl: Date;
};

export const MOTIVO_SIN_COTIZACION =
  "No hay cotización de visita para este socio: solo puede pagar en su sede.";
export const MOTIVO_COTIZACION_INCOMPLETA =
  "La cotización de visita no trae plan, precio o moneda utilizables.";
export const MOTIVO_SIN_PLUS_VIGENTE =
  "El socio no tiene acceso multi-sede vigente, así que solo puede pagar en su sede.";

export type ImporteDeVisita = {
  /** Lo que se cobra, ya con descuento y recargo. */
  readonly total: string;
  /** Precio de lista, para poder enseñar de dónde sale el total. */
  readonly precioLista: string;
  /** Base tras el descuento de la sede dueña. */
  readonly base: string;
  readonly recargoMora: string;
  readonly diasAtraso: number;
  readonly monedaId: string;
  readonly categoriaCliente: string;
  readonly planCodigo: string;
  readonly cuotaNumero: number | null;
  /** Antigüedad de la foto, en días, para poder avisar al operador. */
  readonly antiguedadDias: number;
};

export type DecisionDeCobroDeVisita =
  | { readonly resultado: "PERMITIDO"; readonly importe: ImporteDeVisita }
  | { readonly resultado: "BLOQUEADO"; readonly motivo: string };

const DIA_MS = 86_400_000;

/** Días completos entre dos fechas de calendario, nunca negativos. */
function diasEntre(desde: Date, hasta: Date): number {
  const dias = Math.floor((hasta.getTime() - desde.getTime()) / DIA_MS);
  return dias > 0 ? dias : 0;
}

const texto = (valor: unknown): string => String(valor ?? "").trim();

/**
 * Recargo por mora, recalculado aquí y ahora.
 *
 * Es la mitad que justifica que la mora viaje como regla. Se aplica sobre la
 * base ya descontada, igual que en el cobro de la sede propia
 * (docs/RECARGO_MORA.md), y respeta el tope cuando lo hay.
 */
export function recargoDeLaVisita(input: {
  base: DecimalInput;
  diasAtraso: number;
  mora: MoraDeLaVisita | null;
}): string {
  const mora = input.mora;
  if (!mora || mora.activo !== true || input.diasAtraso <= 0) return "0.00";
  const modo = texto(mora.modo).toUpperCase();
  const valor = texto(mora.valor);
  if (!valor || (modo !== "FIJO" && modo !== "PORCENTAJE")) return "0.00";

  const baseUnidades = decimalToUnits(input.base);
  let recargo =
    modo === "FIJO"
      ? decimalToUnits(valor)
      : (baseUnidades * decimalToUnits(valor)) / 10_000n;
  if (recargo < 0n) recargo = 0n;

  const tope = texto(mora.tope);
  if (tope) {
    const topeUnidades = decimalToUnits(tope);
    if (topeUnidades >= 0n && recargo > topeUnidades) recargo = topeUnidades;
  }
  return unitsToDecimal(recargo);
}

/**
 * Decide si esta sede puede cobrarle al visitante y cuánto.
 *
 * Falla cerrado en todos los bordes: sin cotización, sin plus vigente o con una
 * cotización a la que le falta lo esencial, no se cobra. Es dinero de otro; la
 * duda se resuelve mandándole a pagar en su sede, que siempre puede.
 */
export function cotizarVisita(input: {
  cotizacion: CotizacionDeVisita | null | undefined;
  /** El plus del socio, activo y cubriendo hoy. Lo decide el servidor. */
  accesoMultisedeVigente: boolean;
  /** Fecha de negocio de la sede que cobra, no la del dispositivo. */
  fechaNegocio: Date;
}): DecisionDeCobroDeVisita {
  if (input.accesoMultisedeVigente !== true) {
    return { resultado: "BLOQUEADO", motivo: MOTIVO_SIN_PLUS_VIGENTE };
  }
  const c = input.cotizacion;
  if (!c) return { resultado: "BLOQUEADO", motivo: MOTIVO_SIN_COTIZACION };
  if (!texto(c.planId) || !texto(c.monedaId) || !texto(c.precioFinal)) {
    return { resultado: "BLOQUEADO", motivo: MOTIVO_COTIZACION_INCOMPLETA };
  }

  // Por cuotas manda el importe de la cuota; si no, el precio del plan. El
  // atraso se mide contra la fecha exigible de esa cuota, no contra el fin de
  // cobertura, porque una cuota vencida atrasa aunque la cobertura siga viva.
  const base = c.cuota ? normalizeMoney(c.cuota.importe) : normalizeMoney(c.precioFinal);
  const referencia = c.cuota?.fechaExigible ?? c.cubreHasta;
  const diasAtraso = referencia ? diasEntre(referencia, input.fechaNegocio) : 0;
  const recargo = recargoDeLaVisita({ base, diasAtraso, mora: c.mora });

  return {
    resultado: "PERMITIDO",
    importe: {
      total: unitsToDecimal(decimalToUnits(base) + decimalToUnits(recargo)),
      precioLista: normalizeMoney(c.precioLista),
      base,
      recargoMora: recargo,
      diasAtraso,
      monedaId: c.monedaId,
      categoriaCliente: c.categoriaCliente,
      planCodigo: c.planCodigo,
      cuotaNumero: c.cuota?.numero ?? null,
      antiguedadDias: diasEntre(c.calculadaAl, input.fechaNegocio),
    },
  };
}
