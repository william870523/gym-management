import {
  parseTreasuryMonth,
  TreasuryLedgerPolicyError,
} from "../../domain/treasury-ledger-policy";
import {
  ExchangeRevaluationPolicyError,
  summarizeRevaluation,
  type RevaluationLineInput,
} from "../../domain/exchange-revaluation-policy";
import type { ExchangeRevaluationReader } from "./exchange-revaluation.reader";

export class ExchangeRevaluationServiceError extends Error {
  constructor(message: string, readonly status: 400 | 403 = 400) {
    super(message);
    this.name = "ExchangeRevaluationServiceError";
  }
}

/**
 * R5.5 — Informe de revaluación cambiaria. Solo lectura: valúa los cobros en
 * moneda débil que siguen vivos al corte a la tasa del cobro vs la tasa vigente
 * al corte y presenta la diferencia como pérdida (o ganancia) cambiaria.
 */
export class ExchangeRevaluationService {
  constructor(private readonly reader: ExchangeRevaluationReader) {}

  async get(input: {
    gymId: string;
    month?: unknown;
  }): Promise<Record<string, any>> {
    if (!input.gymId.trim()) {
      throw new ExchangeRevaluationServiceError(
        "No se pudo determinar el gimnasio del informe.",
        403,
      );
    }
    const requestedMonth = String(input.month ?? "").trim() ||
      (await this.reader.currentBusinessMonth(input.gymId));
    const period = this.policy(() => parseTreasuryMonth(requestedMonth));
    const data = await this.reader.read(input.gymId, {
      month: period.month,
      endExclusive: period.endExclusive,
    });
    const cutoffDate = new Date(period.endExclusive.getTime() - 86_400_000)
      .toISOString()
      .slice(0, 10);

    if (!data.baseCurrencyId) {
      return {
        mes: period.month,
        fecha_corte: cutoffDate,
        naturaleza: "REVALUACION_CAMBIARIA",
        estado: "SIN_MONEDA_BASE",
        moneda_base_id: null,
        moneda_base_codigo: null,
        total_revaluacion: "0.00",
        monedas: [],
        cobros: 0,
        cobros_sin_tasa_corte: 0,
        nota:
          "Configura la moneda base (BASE_CURRENCY_ID) para valuar los cobros en moneda débil.",
        limitaciones: LIMITACIONES,
      };
    }

    const lines: RevaluationLineInput[] = data.collections.map((row) => ({
      reference: row.reference,
      weakCurrencyId: row.weakCurrencyId,
      amount: row.amount,
      collectionRate: row.collectionRate,
      cutoffRate: data.cutoffRatesByCurrency.get(row.weakCurrencyId) ?? null,
    }));

    const summary = this.policy(() =>
      summarizeRevaluation(lines, data.baseCurrencyId!),
    );

    const code = (id: string) => data.currencyCodes.get(id) ?? id;
    const monedas = summary.currencies.map((currency) => ({
      moneda_id: currency.weakCurrencyId,
      moneda_codigo: code(currency.weakCurrencyId),
      cobros: currency.lines,
      importe_debil: currency.amountWeak,
      valor_al_cobro: currency.baseAtCollection,
      valor_al_corte: currency.baseAtCutoff,
      revaluacion: currency.revaluation,
      efecto: efecto(currency.revaluation),
      cobros_sin_tasa_corte: currency.linesWithoutCutoffRate,
    }));

    return {
      mes: period.month,
      fecha_corte: cutoffDate,
      naturaleza: "REVALUACION_CAMBIARIA",
      estado: "PROVISIONAL",
      moneda_base_id: data.baseCurrencyId,
      moneda_base_codigo: code(data.baseCurrencyId),
      total_revaluacion: summary.totalRevaluation,
      efecto_total: efecto(summary.totalRevaluation),
      monedas,
      cobros: summary.lines,
      cobros_sin_tasa_corte: summary.linesWithoutCutoffRate,
      nota:
        "Valúa los cobros en moneda débil que aún cubren servicio al corte; la diferencia es la revaluación del periodo, no un asiento contable.",
      limitaciones: LIMITACIONES,
    };
  }

  private policy<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (
        error instanceof TreasuryLedgerPolicyError ||
        error instanceof ExchangeRevaluationPolicyError
      ) {
        throw new ExchangeRevaluationServiceError(error.message);
      }
      throw error;
    }
  }
}

const LIMITACIONES = [
  "Es un informe de lectura; no reescribe cobros, tasas ni los libros existentes.",
  "No convierte ni suma monedas base distintas.",
  "Solo incluye cobros en moneda débil que siguen cubriendo servicio al corte.",
  "Los cobros sin una tasa vigente del par al corte se cuentan aparte y no se valúan.",
];

function efecto(revaluation: string): "PERDIDA" | "GANANCIA" | "NEUTRO" {
  const value = Number(revaluation);
  if (value < 0) return "PERDIDA";
  if (value > 0) return "GANANCIA";
  return "NEUTRO";
}

export function asExchangeRevaluationServiceError(error: unknown) {
  return error instanceof ExchangeRevaluationServiceError ? error : null;
}
