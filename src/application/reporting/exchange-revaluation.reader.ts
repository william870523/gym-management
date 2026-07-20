import type { RevaluationRateRef } from "../../domain/exchange-revaluation-policy";

/**
 * R5.5 — Puerto de lectura del informe de revaluación cambiaria. Consume
 * cobros y tasas históricas; no modifica pagos, tasas ni sincronización.
 */

/** Un cobro en moneda débil que sigue vivo (cubre servicio) al corte. */
export interface RevaluationCollectionRow {
  /** `detalle_pago_id` — trazabilidad. */
  reference: string;
  weakCurrencyId: string;
  /** Importe cobrado en la moneda débil. */
  amount: string;
  /** Tasa congelada del cobro (`DetallePago.tipo_cambio_id`). */
  collectionRate: RevaluationRateRef;
}

export interface ExchangeRevaluationReadData {
  /** Moneda base fuerte configurada (`BASE_CURRENCY_ID`), o null si falta. */
  baseCurrencyId: string | null;
  /** Códigos legibles por `moneda_id`. */
  currencyCodes: Map<string, string>;
  /** Cobros vivos en moneda débil al corte. */
  collections: RevaluationCollectionRow[];
  /** Tasa vigente al corte por moneda débil (para valuar), o ausente. */
  cutoffRatesByCurrency: Map<string, RevaluationRateRef>;
}

export interface ExchangeRevaluationReader {
  currentBusinessMonth(gymId: string): Promise<string>;
  read(
    gymId: string,
    cutoff: { month: string; endExclusive: Date },
  ): Promise<ExchangeRevaluationReadData>;
}
