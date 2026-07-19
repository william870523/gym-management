import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

/**
 * R5.1 — Recargo porcentual por método de pago en la tasa de cambio.
 *
 * El gimnasio cobra la tarifa normal en efectivo y aplica un porcentaje
 * adicional en otros métodos (p. ej. transferencia). El recargo se define al
 * crear o editar la tasa, como mapa `tipo_pago_id → porcentaje`, y ES
 * GANANCIA DEL GIMNASIO: se presenta separado del precio del plan.
 *
 * El mapa se persiste en `TipoCambio.recargos_json`. Como cada cobro congela
 * su `tipo_cambio_id`, el desglose histórico siempre es reconstruible.
 */

export class ExchangeRateSurchargePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExchangeRateSurchargePolicyError";
  }
}

/** Normaliza y valida el mapa de recargos recibido de la API. */
export function normalizeExchangeRateSurcharges(
  value: unknown,
): Record<string, string> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ExchangeRateSurchargePolicyError(
      "Los recargos deben ser un objeto { tipo_pago_id: porcentaje }.",
    );
  }
  const normalized: Record<string, string> = {};
  for (const [paymentTypeId, rawPct] of Object.entries(value as Record<string, unknown>)) {
    const id = paymentTypeId.trim();
    if (!id || id.length > 191) {
      throw new ExchangeRateSurchargePolicyError(
        "El método de pago de un recargo no es válido.",
      );
    }
    let pctMinor: bigint;
    try {
      pctMinor = treasuryMoneyToMinor(String(rawPct ?? ""));
    } catch {
      throw new ExchangeRateSurchargePolicyError(
        `El porcentaje del recargo para ${id} debe ser un decimal con hasta dos cifras.`,
      );
    }
    if (pctMinor < 0n || pctMinor > 10000n) {
      throw new ExchangeRateSurchargePolicyError(
        `El porcentaje del recargo para ${id} debe estar entre 0 y 100.`,
      );
    }
    if (pctMinor === 0n) continue; // sin fila = sin recargo
    normalized[id] = treasuryMinorToMoney(pctMinor);
  }
  return normalized;
}

/** Serializa para `recargos_json`; null cuando no hay recargos. */
export function serializeExchangeRateSurcharges(
  value: unknown,
): string | null {
  const normalized = normalizeExchangeRateSurcharges(value);
  return Object.keys(normalized).length === 0
    ? null
    : JSON.stringify(normalized);
}

/** Lee `recargos_json` persistido; tolera nulos y JSON corrupto explícito. */
export function parseExchangeRateSurcharges(
  stored: string | null | undefined,
): Record<string, string> {
  if (!stored) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new ExchangeRateSurchargePolicyError(
      "Los recargos persistidos de la tasa no son legibles.",
    );
  }
  return normalizeExchangeRateSurcharges(parsed);
}

/**
 * Recargo exacto en unidades menores para un importe base y un método.
 * Redondeo half-up determinista; sin `Float`.
 */
export function surchargeMinor(
  baseMinor: bigint,
  surcharges: Record<string, string>,
  paymentTypeId: string,
): bigint {
  if (baseMinor < 0n) {
    throw new ExchangeRateSurchargePolicyError(
      "El importe base de un recargo no puede ser negativo.",
    );
  }
  const pct = surcharges[paymentTypeId];
  if (!pct) return 0n;
  const pctMinor = treasuryMoneyToMinor(pct); // 5.00 % → 500
  const rawCents = (baseMinor * pctMinor + 9999n) / 10000n;
  if (rawCents === 0n) return 0n;
  // Redondeo al entero superior en unidades principales (múltiplos de 100 centavos):
  const integerUnits = (rawCents + 99n) / 100n;
  return integerUnits * 100n;
}

/** Desglose listo para recibo: base, recargo y total como decimales. */
export function surchargeBreakdown(
  baseAmount: string,
  surcharges: Record<string, string>,
  paymentTypeId: string,
) {
  const baseMinor = treasuryMoneyToMinor(baseAmount);
  const surcharge = surchargeMinor(baseMinor, surcharges, paymentTypeId);
  return {
    base: treasuryMinorToMoney(baseMinor),
    recargo_pct: surcharges[paymentTypeId] ?? null,
    recargo: treasuryMinorToMoney(surcharge),
    total: treasuryMinorToMoney(baseMinor + surcharge),
  };
}
