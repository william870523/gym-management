import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";
import { decimalToUnits, type DecimalInput } from "./money";

/**
 * R5.5 — Revaluación cambiaria (pérdida/ganancia por devaluación).
 *
 * El gimnasio cobra en una moneda débil (p. ej. CUP) valores que, medidos en
 * la moneda base fuerte (p. ej. EUR), pierden poder con la inflación. Este
 * informe **solo lee**: no convierte los libros existentes ni reescribe cobros.
 * Para cada cobro en moneda débil que **sigue vivo al corte** (aún cubre
 * servicio) toma su importe en moneda débil y lo valúa:
 *   - a la **tasa congelada del cobro** (`DetallePago.tipo_cambio_id`), y
 *   - a la **tasa vigente al corte** del mismo par de monedas;
 * la diferencia (corte − cobro) es la revaluación: negativa = pérdida.
 *
 * La conversión reutiliza exactamente la convención del libro de Tesorería
 * (`detailConversion`): la tasa base→target usa `1/tasa`; target→base usa
 * `tasa`. El redondeo del valor en moneda base es al céntimo más cercano; es un
 * informe de lectura, no un asiento contable.
 */

export class ExchangeRevaluationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExchangeRevaluationPolicyError";
  }
}

/** Una tasa de cambio con su orientación (par base→target). */
export interface RevaluationRateRef {
  monedaIdBase: string;
  monedaIdTarget: string;
  exchangeRate: DecimalInput;
}

/**
 * Factor para convertir 1 unidad de `weakCurrencyId` a la moneda base.
 * Réplica de `TreasuryLedgerService.detailConversion`.
 */
export function baseFactor(
  rate: RevaluationRateRef,
  weakCurrencyId: string,
  baseCurrencyId: string,
): number {
  if (weakCurrencyId === baseCurrencyId) return 1;
  const value = Number(rate.exchangeRate);
  if (!Number.isFinite(value) || value <= 0) {
    throw new ExchangeRevaluationPolicyError(
      "La tasa de cambio debe ser un número positivo.",
    );
  }
  if (
    rate.monedaIdBase === baseCurrencyId &&
    rate.monedaIdTarget === weakCurrencyId
  ) {
    return 1 / value;
  }
  if (
    rate.monedaIdBase === weakCurrencyId &&
    rate.monedaIdTarget === baseCurrencyId
  ) {
    return value;
  }
  throw new ExchangeRevaluationPolicyError(
    "La tasa no corresponde al par moneda débil / moneda base solicitado.",
  );
}

/** Convierte un importe (money) de la moneda débil a la base, al céntimo. */
function toBaseMinor(
  amount: string,
  rate: RevaluationRateRef,
  weakCurrencyId: string,
  baseCurrencyId: string,
): bigint {
  const weakMinor = treasuryMoneyToMinor(amount);
  baseFactor(rate, weakCurrencyId, baseCurrencyId);
  const rateUnits = decimalToUnits(rate.exchangeRate, 8);
  const scale = 100_000_000n;
  const roundHalfUp = (numerator: bigint, denominator: bigint) => {
    const negative = numerator < 0n;
    const absolute = negative ? -numerator : numerator;
    const result = absolute / denominator +
      (absolute % denominator * 2n >= denominator ? 1n : 0n);
    return negative ? -result : result;
  };
  if (
    rate.monedaIdBase === baseCurrencyId &&
    rate.monedaIdTarget === weakCurrencyId
  ) {
    return roundHalfUp(weakMinor * scale, rateUnits);
  }
  return roundHalfUp(weakMinor * rateUnits, scale);
}

export interface RevaluationLineInput {
  /** Identificador del cobro (para trazabilidad; no participa del cálculo). */
  reference: string;
  weakCurrencyId: string;
  /** Importe cobrado en la moneda débil. */
  amount: string;
  /** Tasa congelada al momento del cobro. */
  collectionRate: RevaluationRateRef;
  /** Tasa vigente al corte; null si no hay tasa del par al corte. */
  cutoffRate: RevaluationRateRef | null;
}

export interface RevaluationLineResult {
  reference: string;
  amountWeak: string;
  baseAtCollection: string;
  baseAtCutoff: string | null;
  /** corte − cobro; negativo = pérdida. Null si falta la tasa al corte. */
  revaluation: string | null;
}

export function revalueLine(
  input: RevaluationLineInput,
  baseCurrencyId: string,
): RevaluationLineResult {
  const collectionMinor = toBaseMinor(
    input.amount,
    input.collectionRate,
    input.weakCurrencyId,
    baseCurrencyId,
  );
  if (!input.cutoffRate) {
    return {
      reference: input.reference,
      amountWeak: treasuryMinorToMoney(treasuryMoneyToMinor(input.amount)),
      baseAtCollection: treasuryMinorToMoney(collectionMinor),
      baseAtCutoff: null,
      revaluation: null,
    };
  }
  const cutoffMinor = toBaseMinor(
    input.amount,
    input.cutoffRate,
    input.weakCurrencyId,
    baseCurrencyId,
  );
  return {
    reference: input.reference,
    amountWeak: treasuryMinorToMoney(treasuryMoneyToMinor(input.amount)),
    baseAtCollection: treasuryMinorToMoney(collectionMinor),
    baseAtCutoff: treasuryMinorToMoney(cutoffMinor),
    revaluation: treasuryMinorToMoney(cutoffMinor - collectionMinor),
  };
}

export interface RevaluationCurrencyResult {
  weakCurrencyId: string;
  lines: number;
  amountWeak: string;
  baseAtCollection: string;
  baseAtCutoff: string;
  revaluation: string;
  /** Líneas sin tasa vigente al corte: no se pudieron revaluar. */
  linesWithoutCutoffRate: number;
}

export interface RevaluationSummary {
  baseCurrencyId: string;
  currencies: RevaluationCurrencyResult[];
  totalRevaluation: string;
  lines: number;
  linesWithoutCutoffRate: number;
}

/**
 * Agrega las líneas por moneda débil y produce el resumen. Las líneas cuya
 * moneda coincide con la base se ignoran (no hay revaluación posible).
 */
export function summarizeRevaluation(
  inputs: RevaluationLineInput[],
  baseCurrencyId: string,
): RevaluationSummary {
  const byCurrency = new Map<string, {
    lines: number;
    weak: bigint;
    // Base al cobro y al corte SOLO de líneas revaluables (con tasa al corte),
    // para que `cutoff − collection` sea una diferencia coherente.
    collectionRevalued: bigint;
    cutoff: bigint;
    withoutCutoff: number;
  }>();

  for (const input of inputs) {
    if (input.weakCurrencyId === baseCurrencyId) continue;
    const line = revalueLine(input, baseCurrencyId);
    const bucket = byCurrency.get(input.weakCurrencyId) ?? {
      lines: 0,
      weak: 0n,
      collectionRevalued: 0n,
      cutoff: 0n,
      withoutCutoff: 0,
    };
    bucket.lines += 1;
    bucket.weak += treasuryMoneyToMinor(line.amountWeak);
    if (line.baseAtCutoff === null) {
      bucket.withoutCutoff += 1;
    } else {
      bucket.collectionRevalued += treasuryMoneyToMinor(line.baseAtCollection);
      bucket.cutoff += treasuryMoneyToMinor(line.baseAtCutoff);
    }
    byCurrency.set(input.weakCurrencyId, bucket);
  }

  let totalRevaluationMinor = 0n;
  let totalLines = 0;
  let totalWithoutCutoff = 0;
  const currencies: RevaluationCurrencyResult[] = [...byCurrency.entries()]
    .map(([weakCurrencyId, bucket]) => {
      const revaluationMinor = bucket.cutoff - bucket.collectionRevalued;
      totalRevaluationMinor += revaluationMinor;
      totalLines += bucket.lines;
      totalWithoutCutoff += bucket.withoutCutoff;
      return {
        weakCurrencyId,
        lines: bucket.lines,
        amountWeak: treasuryMinorToMoney(bucket.weak),
        baseAtCollection: treasuryMinorToMoney(bucket.collectionRevalued),
        baseAtCutoff: treasuryMinorToMoney(bucket.cutoff),
        revaluation: treasuryMinorToMoney(revaluationMinor),
        linesWithoutCutoffRate: bucket.withoutCutoff,
      };
    })
    .sort((a, b) => a.weakCurrencyId.localeCompare(b.weakCurrencyId));

  return {
    baseCurrencyId,
    currencies,
    totalRevaluation: treasuryMinorToMoney(totalRevaluationMinor),
    lines: totalLines,
    linesWithoutCutoffRate: totalWithoutCutoff,
  };
}
