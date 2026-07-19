import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

type JsonRecord = Record<string, any>;

export type ManagementMarginAnnualMonthStatus =
  | "CERTIFICADO"
  | "SIN_CIERRE"
  | "REABIERTO"
  | "SNAPSHOT_ANTERIOR"
  | "INTEGRIDAD_INVALIDA"
  | "SNAPSHOT_INCOMPATIBLE"
  | "BLOQUEO_INVALIDO"
  | "EN_CURSO"
  | "FUTURO";

export type ManagementMarginAnnualMonthInput = {
  month: string;
  status: ManagementMarginAnnualMonthStatus;
  reason: string;
  monthlyCloseId?: string;
  sha256?: string;
  closedAt?: string;
  result?: JsonRecord;
};

type AnnualMarginMonth = {
  mes: string;
  ingreso_devengado: string;
  costo_directo: string;
  margen_directo: string;
  fijo_no_distribuido: string;
  margen_menos_fijo: string;
  margen_directo_pct: string | null;
  ingreso_devengado_acumulado: string;
  costo_directo_acumulado: string;
  margen_directo_acumulado: string;
  fijo_no_distribuido_acumulado: string;
  margen_menos_fijo_acumulado: string;
  margen_directo_pct_acumulado: string | null;
};

type AnnualMarginCurrencyAccumulator = {
  currencyId: string;
  currencyCode: string;
  revenue: bigint;
  directCost: bigint;
  directMargin: bigint;
  fixed: bigint;
  marginAfterFixed: bigint;
  months: AnnualMarginMonth[];
};

export class ManagementMarginAnnualPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagementMarginAnnualPolicyError";
  }
}

export function parseManagementMarginYear(value: unknown) {
  const year = String(value ?? "").trim();
  if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 9999) {
    throw new ManagementMarginAnnualPolicyError(
      "El año debe usar el formato AAAA.",
    );
  }
  return year;
}

export function buildManagementMarginAnnualComparison(input: {
  year: string;
  currentBusinessMonth: string;
  months: ManagementMarginAnnualMonthInput[];
}) {
  const year = parseManagementMarginYear(input.year);
  if (!/^\d{4}-\d{2}$/.test(input.currentBusinessMonth)) {
    throw new ManagementMarginAnnualPolicyError(
      "El mes comercial actual no tiene un formato válido.",
    );
  }

  const normalizedMonths = input.months.map((month) => ({ ...month })).sort((a, b) =>
    a.month.localeCompare(b.month)
  );
  const currencies = new Map<string, AnnualMarginCurrencyAccumulator>();

  for (const month of normalizedMonths) {
    if (month.status !== "CERTIFICADO" || !month.result) continue;
    if (
      month.result.mes !== month.month ||
      month.result.naturaleza !== "MARGEN_GERENCIAL" ||
      month.result.certificado !== true
    ) {
      month.status = "SNAPSHOT_INCOMPATIBLE";
      month.reason =
        "El resultado devengado firmado no corresponde a este mes o no está certificado.";
      month.result = undefined;
      continue;
    }
    try {
      for (const currency of array(month.result.monedas)) {
        const currencyId = requiredText(currency.moneda_id, "moneda_id");
        const currencyCode = requiredText(
          currency.moneda_codigo,
          "moneda_codigo",
        );
        const accumulator = currencies.get(currencyId) ?? {
          currencyId,
          currencyCode,
          revenue: 0n,
          directCost: 0n,
          directMargin: 0n,
          fixed: 0n,
          marginAfterFixed: 0n,
          months: [],
        };
        const revenue = money(
          currency.ingreso_devengado_mes,
          "ingreso_devengado_mes",
        );
        const directCost = money(currency.costo_directo_mes, "costo_directo_mes");
        const directMargin = money(
          currency.margen_directo_mes,
          "margen_directo_mes",
        );
        const fixed = money(
          currency.fijo_no_distribuido_mes,
          "fijo_no_distribuido_mes",
        );
        const marginAfterFixed = money(
          currency.margen_menos_fijo_mes,
          "margen_menos_fijo_mes",
        );
        const revenueToDate = money(
          currency.ingreso_devengado_acumulado,
          "ingreso_devengado_acumulado",
        );
        const directCostToDate = money(
          currency.costo_directo_acumulado,
          "costo_directo_acumulado",
        );
        const directMarginToDate = money(
          currency.margen_directo_acumulado,
          "margen_directo_acumulado",
        );
        const fixedToDate = money(
          currency.fijo_no_distribuido_acumulado,
          "fijo_no_distribuido_acumulado",
        );
        const marginAfterFixedToDate = money(
          currency.margen_menos_fijo_acumulado,
          "margen_menos_fijo_acumulado",
        );
        accumulator.currencyCode = currencyCode;
        accumulator.revenue += revenue;
        accumulator.directCost += directCost;
        accumulator.directMargin += directMargin;
        accumulator.fixed += fixed;
        accumulator.marginAfterFixed += marginAfterFixed;
        accumulator.months.push({
          mes: month.month,
          ingreso_devengado: treasuryMinorToMoney(revenue),
          costo_directo: treasuryMinorToMoney(directCost),
          margen_directo: treasuryMinorToMoney(directMargin),
          fijo_no_distribuido: treasuryMinorToMoney(fixed),
          margen_menos_fijo: treasuryMinorToMoney(marginAfterFixed),
          margen_directo_pct: percentage(directMargin, revenue),
          ingreso_devengado_acumulado: treasuryMinorToMoney(revenueToDate),
          costo_directo_acumulado: treasuryMinorToMoney(directCostToDate),
          margen_directo_acumulado: treasuryMinorToMoney(directMarginToDate),
          fijo_no_distribuido_acumulado: treasuryMinorToMoney(fixedToDate),
          margen_menos_fijo_acumulado:
            treasuryMinorToMoney(marginAfterFixedToDate),
          margen_directo_pct_acumulado:
            percentage(directMarginToDate, revenueToDate),
        });
        currencies.set(currencyId, accumulator);
      }
    } catch (error) {
      month.status = "SNAPSHOT_INCOMPATIBLE";
      month.reason = error instanceof Error
        ? `El snapshot no cumple el contrato anual del devengado: ${error.message}`
        : "El snapshot no cumple el contrato anual del devengado.";
      month.result = undefined;
      removeMonth(currencies, month.month);
    }
  }

  const eligibleMonths = normalizedMonths.filter((month) =>
    month.month < input.currentBusinessMonth
  ).length;
  const certifiedEligibleMonths = normalizedMonths.filter((month) =>
    month.month < input.currentBusinessMonth && month.status === "CERTIFICADO"
  ).length;
  const certifiedMonths = normalizedMonths.filter((month) =>
    month.status === "CERTIFICADO"
  ).length;
  const missingRequiredMonths = Math.max(
    0,
    eligibleMonths - certifiedEligibleMonths,
  );

  return {
    anio: year,
    naturaleza: "COMPARATIVA_ANUAL_RESULTADO_DEVENGADO_CERTIFICADO",
    mes_comercial_actual: input.currentBusinessMonth,
    cobertura: {
      meses_exigibles: eligibleMonths,
      meses_certificados: certifiedMonths,
      meses_certificados_exigibles: certifiedEligibleMonths,
      meses_pendientes: missingRequiredMonths,
      porcentaje_exigible: eligibleMonths === 0
        ? null
        : Number(((certifiedEligibleMonths / eligibleMonths) * 100).toFixed(1)),
      completa: eligibleMonths > 0 && missingRequiredMonths === 0,
    },
    meses: normalizedMonths.map((month) => ({
      mes: month.month,
      estado: month.status,
      motivo: month.reason,
      cierre_mensual_id: month.monthlyCloseId ?? null,
      resumen_sha256: month.sha256 ?? null,
      cerrado_at: month.closedAt ?? null,
    })),
    monedas: [...currencies.values()]
      .map((currency) => annualCurrency(currency))
      .sort((a, b) => a.moneda_codigo.localeCompare(b.moneda_codigo)),
    nota_cobertura: missingRequiredMonths === 0 && eligibleMonths > 0
      ? "Todos los meses ya exigibles del año tienen resultado devengado R4.4 certificado."
      : "La comparación usa solo meses con snapshot v3 certificado; los meses ausentes no se rellenan con cero.",
    limitaciones: [
      "No suma ni convierte monedas diferentes.",
      "Los totales anuales suman importes devengados del mes; los acumulados muestran únicamente el último corte certificado.",
      "No incorpora gastos generales, proveedores, depreciación, impuestos ni doble partida.",
    ],
  };
}

function annualCurrency(currency: AnnualMarginCurrencyAccumulator) {
  currency.months.sort((a, b) => a.mes.localeCompare(b.mes));
  const byMargin = [...currency.months].sort((a, b) =>
    compareMoney(a.margen_directo, b.margen_directo)
  );
  const latest = currency.months.length === 0
    ? null
    : currency.months[currency.months.length - 1];
  const highest = byMargin.length === 0 ? null : byMargin[byMargin.length - 1];
  const lowest = byMargin[0] ?? null;
  return {
    moneda_id: currency.currencyId,
    moneda_codigo: currency.currencyCode,
    meses_con_datos: currency.months.length,
    totales_devengo: {
      ingreso_devengado: treasuryMinorToMoney(currency.revenue),
      costo_directo: treasuryMinorToMoney(currency.directCost),
      margen_directo: treasuryMinorToMoney(currency.directMargin),
      fijo_no_distribuido: treasuryMinorToMoney(currency.fixed),
      margen_menos_fijo: treasuryMinorToMoney(currency.marginAfterFixed),
      margen_directo_pct: percentage(currency.directMargin, currency.revenue),
    },
    ultimo_corte: latest
      ? {
          mes: latest.mes,
          ingreso_devengado_acumulado: latest.ingreso_devengado_acumulado,
          costo_directo_acumulado: latest.costo_directo_acumulado,
          margen_directo_acumulado: latest.margen_directo_acumulado,
          fijo_no_distribuido_acumulado: latest.fijo_no_distribuido_acumulado,
          margen_menos_fijo_acumulado: latest.margen_menos_fijo_acumulado,
          margen_directo_pct_acumulado: latest.margen_directo_pct_acumulado,
        }
      : null,
    mayor_margen: highest
      ? { mes: highest.mes, monto: highest.margen_directo }
      : null,
    menor_margen: lowest
      ? { mes: lowest.mes, monto: lowest.margen_directo }
      : null,
    meses: currency.months,
  };
}

function removeMonth(
  currencies: Map<string, AnnualMarginCurrencyAccumulator>,
  month: string,
) {
  const empty: string[] = [];
  for (const [currencyId, currency] of currencies) {
    const kept = currency.months.filter((item) => item.mes !== month);
    if (kept.length === currency.months.length) continue;
    currency.revenue = 0n;
    currency.directCost = 0n;
    currency.directMargin = 0n;
    currency.fixed = 0n;
    currency.marginAfterFixed = 0n;
    currency.months = kept;
    for (const row of kept) {
      currency.revenue += money(row.ingreso_devengado, "ingreso_devengado");
      currency.directCost += money(row.costo_directo, "costo_directo");
      currency.directMargin += money(row.margen_directo, "margen_directo");
      currency.fixed += money(row.fijo_no_distribuido, "fijo_no_distribuido");
      currency.marginAfterFixed += money(
        row.margen_menos_fijo,
        "margen_menos_fijo",
      );
    }
    if (kept.length === 0) empty.push(currencyId);
  }
  for (const currencyId of empty) currencies.delete(currencyId);
}

function money(value: unknown, field: string) {
  const text = requiredText(value, field);
  try {
    return treasuryMoneyToMinor(text);
  } catch {
    throw new ManagementMarginAnnualPolicyError(
      `${field} no contiene un importe decimal válido.`,
    );
  }
}

function requiredText(value: unknown, field: string) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new ManagementMarginAnnualPolicyError(
      `Falta el campo ${field}.`,
    );
  }
  return text;
}

function array(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    throw new ManagementMarginAnnualPolicyError(
      "El snapshot no contiene una lista de monedas válida.",
    );
  }
  return value.filter((item) => item && typeof item === "object") as JsonRecord[];
}

function compareMoney(left: string, right: string) {
  const a = treasuryMoneyToMinor(left);
  const b = treasuryMoneyToMinor(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function percentage(numerator: bigint, denominator: bigint) {
  if (denominator === 0n) return null;
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const scaled = (absolute * 1000n + denominator / 2n) / denominator;
  const integer = scaled / 10n;
  const decimal = scaled % 10n;
  return `${negative ? "-" : ""}${integer}.${decimal}`;
}
