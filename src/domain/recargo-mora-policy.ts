import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

/**
 * Recargo por mora (pago atrasado). Diseño: docs/RECARGO_MORA.md.
 *
 * El administrador configura, POR PLAN, uno de tres modos de recargo que se
 * cobra cuando el socio paga con atraso. El recepcionista solo marca «aplicar»
 * en la ventana de cobro; el servidor calcula el importe con esta política.
 *
 * Todo el cálculo es en unidades menores (centavos) con enteros: nunca `Float`.
 * El recargo es ganancia del gimnasio y se reporta aparte del precio del plan.
 */

export type RecargoMoraModo = "PORCENTAJE" | "MONTO_FIJO" | "POR_DIA";

export const RECARGO_MORA_MODOS: readonly RecargoMoraModo[] = [
  "PORCENTAJE",
  "MONTO_FIJO",
  "POR_DIA",
];

export type RecargoMoraMotivo =
  | "OK"
  | "SIN_CONFIG"
  | "INACTIVO"
  | "SIN_ATRASO"
  | "NO_APLICADO";

export class RecargoMoraPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecargoMoraPolicyError";
  }
}

/** Configuración de recargo por mora de un plan. */
export interface RecargoMoraPlanConfig {
  modo: RecargoMoraModo;
  /** Decimal string: porcentaje (0–100) en PORCENTAJE; monto en los otros. */
  valor: string;
  /** Decimal string; solo POR_DIA. `null` = sin tope. */
  tope: string | null;
  activo: boolean;
}

export interface RecargoMoraQuote {
  aplicado: boolean;
  modo: RecargoMoraModo | null;
  dias_atraso: number;
  base: string;
  recargo: string;
  total: string;
  motivo: RecargoMoraMotivo;
}

/**
 * Normaliza y valida la configuración que el administrador guarda en un plan.
 * Devuelve `null` cuando el plan no tiene recargo (modo nulo/vacío).
 */
export function normalizeRecargoMoraConfig(input: {
  modo?: unknown;
  valor?: unknown;
  tope?: unknown;
  activo?: unknown;
}): RecargoMoraPlanConfig | null {
  const rawModo = String(input?.modo ?? "").trim().toUpperCase();
  if (rawModo === "") return null;
  if (!RECARGO_MORA_MODOS.includes(rawModo as RecargoMoraModo)) {
    throw new RecargoMoraPolicyError(
      `El modo de recargo debe ser uno de: ${RECARGO_MORA_MODOS.join(", ")}.`,
    );
  }
  const modo = rawModo as RecargoMoraModo;

  let valorMinor: bigint;
  try {
    valorMinor = treasuryMoneyToMinor(String(input?.valor ?? ""));
  } catch {
    throw new RecargoMoraPolicyError(
      "El valor del recargo debe ser un decimal con hasta dos cifras.",
    );
  }
  if (valorMinor <= 0n) {
    throw new RecargoMoraPolicyError(
      "El valor del recargo debe ser mayor que cero.",
    );
  }
  if (modo === "PORCENTAJE" && valorMinor > 10000n) {
    throw new RecargoMoraPolicyError(
      "El porcentaje del recargo debe estar entre 0 y 100.",
    );
  }

  let tope: string | null = null;
  if (input?.tope != null && String(input.tope).trim() !== "") {
    if (modo !== "POR_DIA") {
      throw new RecargoMoraPolicyError(
        "El tope solo aplica al modo POR_DIA.",
      );
    }
    let topeMinor: bigint;
    try {
      topeMinor = treasuryMoneyToMinor(String(input.tope));
    } catch {
      throw new RecargoMoraPolicyError(
        "El tope del recargo debe ser un decimal con hasta dos cifras.",
      );
    }
    if (topeMinor <= 0n) {
      throw new RecargoMoraPolicyError("El tope debe ser mayor que cero.");
    }
    tope = treasuryMinorToMoney(topeMinor);
  }

  return {
    modo,
    valor: treasuryMinorToMoney(valorMinor),
    tope,
    activo: Boolean(input?.activo),
  };
}

/**
 * Condonación del recargo (docs/RECARGO_MORA.md §6-bis).
 *
 * El recargo se aplica siempre que corresponda; perdonarlo es una EXCEPCIÓN que
 * exige motivo y deja rastro. Sin esto, un recepcionista podría cobrar el
 * recargo al socio y registrar el pago sin él, quedándose la diferencia.
 */
export const RECARGO_MORA_MOTIVO_MIN = 5;

export interface RecargoMoraCondonacion {
  recargo_mora_condonado_importe: string;
  recargo_mora_condonado_motivo: string;
  recargo_mora_condonado_por: string | null;
}

/**
 * Valida una condonación y devuelve las columnas a persistir.
 * `importeQueSeIbaACobrar` lo calcula el servidor, nunca el cliente.
 */
export function buildRecargoMoraCondonacion(input: {
  importeQueSeIbaACobrar: string;
  motivo: unknown;
  condonadoPorUserId?: string | null;
}): RecargoMoraCondonacion {
  const motivo = String(input.motivo ?? "").trim();
  if (motivo.length < RECARGO_MORA_MOTIVO_MIN) {
    throw new RecargoMoraPolicyError(
      `Para condonar el recargo hay que indicar un motivo de al menos ${RECARGO_MORA_MOTIVO_MIN} caracteres.`,
    );
  }
  if (motivo.length > 500) {
    throw new RecargoMoraPolicyError("El motivo de la condonación es demasiado largo.");
  }
  const importeMinor = treasuryMoneyToMinor(input.importeQueSeIbaACobrar);
  if (importeMinor <= 0n) {
    throw new RecargoMoraPolicyError(
      "No hay recargo que condonar en este cobro.",
    );
  }
  return {
    recargo_mora_condonado_importe: treasuryMinorToMoney(importeMinor),
    recargo_mora_condonado_motivo: motivo,
    recargo_mora_condonado_por: input.condonadoPorUserId ?? null,
  };
}

/** Columnas persistidas de la configuración de recargo de un plan. */
export interface RecargoMoraColumns {
  recargo_mora_modo: string | null;
  recargo_mora_valor: string | null;
  recargo_mora_tope: string | null;
  recargo_mora_activo: boolean;
}

/**
 * Valida la configuración que envía el administrador y devuelve las columnas
 * listas para persistir. Sin modo (o modo vacío) el plan queda sin recargo.
 * Lanza `RecargoMoraPolicyError` si los valores son inválidos.
 */
export function recargoMoraColumns(input: {
  modo?: unknown;
  valor?: unknown;
  tope?: unknown;
  activo?: unknown;
}): RecargoMoraColumns {
  const config = normalizeRecargoMoraConfig(input);
  if (!config) {
    return {
      recargo_mora_modo: null,
      recargo_mora_valor: null,
      recargo_mora_tope: null,
      recargo_mora_activo: false,
    };
  }
  return {
    recargo_mora_modo: config.modo,
    recargo_mora_valor: config.valor,
    recargo_mora_tope: config.tope,
    recargo_mora_activo: config.activo,
  };
}

/**
 * Días completos de atraso entre el vencimiento y la fecha de negocio.
 *
 * Ambos se normalizan a día de calendario UTC: la fecha de negocio ya viene
 * calculada con `Gym.timezone`, así que aquí no se vuelve a convertir zona.
 * Sin vencimiento, o pagando el mismo día o antes, no hay atraso.
 */
export function calcularDiasAtraso(
  businessToday: Date,
  dueDate: Date | null | undefined,
): number {
  if (!dueDate) return 0;
  const due = Date.UTC(
    dueDate.getUTCFullYear(),
    dueDate.getUTCMonth(),
    dueDate.getUTCDate(),
  );
  const today = Date.UTC(
    businessToday.getUTCFullYear(),
    businessToday.getUTCMonth(),
    businessToday.getUTCDate(),
  );
  const ms = today - due;
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}

/** Redondeo half-up en centavos de `base * pct%`. */
function percentMinor(baseMinor: bigint, pctMinor: bigint): bigint {
  // pctMinor = porcentaje × 100 (10.00% → 1000). base × pct/100 en centavos:
  return (baseMinor * pctMinor + 5000n) / 10000n;
}

/**
 * Cotización autoritativa del recargo para un cobro. El servidor la calcula una
 * sola vez y la congela en el detalle del pago.
 */
export function quoteRecargoMora(params: {
  /** Base tras descuento R5.3, decimal string. */
  baseAmount: string;
  diasAtraso: number;
  aplicar: boolean;
  config: RecargoMoraPlanConfig | null;
}): RecargoMoraQuote {
  const baseMinor = treasuryMoneyToMinor(params.baseAmount);
  if (baseMinor < 0n) {
    throw new RecargoMoraPolicyError(
      "La base del recargo no puede ser negativa.",
    );
  }
  const dias = Number.isFinite(params.diasAtraso)
    ? Math.trunc(params.diasAtraso)
    : 0;

  const noAplica = (motivo: RecargoMoraMotivo): RecargoMoraQuote => ({
    aplicado: false,
    modo: params.config?.modo ?? null,
    dias_atraso: Math.max(0, dias),
    base: treasuryMinorToMoney(baseMinor),
    recargo: treasuryMinorToMoney(0n),
    total: treasuryMinorToMoney(baseMinor),
    motivo,
  });

  if (!params.config) return noAplica("SIN_CONFIG");
  if (!params.config.activo) return noAplica("INACTIVO");
  if (!params.aplicar) return noAplica("NO_APLICADO");
  if (dias <= 0) return noAplica("SIN_ATRASO");

  const valorMinor = treasuryMoneyToMinor(params.config.valor);
  let recargoMinor: bigint;
  switch (params.config.modo) {
    case "PORCENTAJE":
      recargoMinor = percentMinor(baseMinor, valorMinor);
      break;
    case "MONTO_FIJO":
      recargoMinor = valorMinor;
      break;
    case "POR_DIA": {
      recargoMinor = valorMinor * BigInt(dias);
      if (params.config.tope != null) {
        const topeMinor = treasuryMoneyToMinor(params.config.tope);
        if (recargoMinor > topeMinor) recargoMinor = topeMinor;
      }
      break;
    }
    default:
      throw new RecargoMoraPolicyError("Modo de recargo desconocido.");
  }

  if (recargoMinor < 0n) recargoMinor = 0n;

  return {
    aplicado: recargoMinor > 0n,
    modo: params.config.modo,
    dias_atraso: dias,
    base: treasuryMinorToMoney(baseMinor),
    recargo: treasuryMinorToMoney(recargoMinor),
    total: treasuryMinorToMoney(baseMinor + recargoMinor),
    motivo: recargoMinor > 0n ? "OK" : "SIN_ATRASO",
  };
}
