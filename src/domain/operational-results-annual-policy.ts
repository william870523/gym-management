import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

type JsonRecord = Record<string, any>;

export type OperationalAnnualMonthStatus =
  | "CERTIFICADO"
  | "SIN_CIERRE"
  | "REABIERTO"
  | "SNAPSHOT_ANTERIOR"
  | "INTEGRIDAD_INVALIDA"
  | "SNAPSHOT_INCOMPATIBLE"
  | "EN_CURSO"
  | "FUTURO";

export type OperationalAnnualMonthInput = {
  month: string;
  status: OperationalAnnualMonthStatus;
  reason: string;
  monthlyCloseId?: string;
  sha256?: string;
  closedAt?: string;
  result?: JsonRecord;
};

type AnnualCurrencyAccumulator = {
  currencyId: string;
  currencyCode: string;
  grossCollections: bigint;
  ledgerExits: bigint;
  operationalFlow: bigint;
  trainerPayments: bigint;
  refunds: bigint;
  otherOperationalExits: bigint;
  months: Array<{
    mes: string;
    cobros_brutos: string;
    salidas_libro: string;
    flujo_operativo: string;
    pagos_entrenadores_netos: string;
    reembolsos_netos: string;
    otros_egresos_operativos: string;
    reserva_inmediata: string | null;
    pagadero_ahora: string | null;
    fondo_futuro: string | null;
    devoluciones_pendientes: string | null;
    compromiso_total: string | null;
  }>;
};

export class OperationalResultsAnnualPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationalResultsAnnualPolicyError";
  }
}

export function parseOperationalResultsYear(value: unknown) {
  const year = String(value ?? "").trim();
  if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 9999) {
    throw new OperationalResultsAnnualPolicyError(
      "El año debe usar el formato AAAA.",
    );
  }
  return year;
}

export function buildOperationalAnnualComparison(input: {
  year: string;
  currentBusinessMonth: string;
  months: OperationalAnnualMonthInput[];
}) {
  const year = parseOperationalResultsYear(input.year);
  if (!/^\d{4}-\d{2}$/.test(input.currentBusinessMonth)) {
    throw new OperationalResultsAnnualPolicyError(
      "El mes comercial actual no tiene un formato válido.",
    );
  }
  const normalizedMonths = input.months.map((month) => ({ ...month })).sort((a, b) =>
    a.month.localeCompare(b.month)
  );
  const currencies = new Map<string, AnnualCurrencyAccumulator>();

  for (const month of normalizedMonths) {
    if (month.status !== "CERTIFICADO" || !month.result) continue;
    if (
      month.result.mes !== month.month ||
      month.result.naturaleza !== "RESULTADO_OPERATIVO_DE_CAJA"
    ) {
      month.status = "SNAPSHOT_INCOMPATIBLE";
      month.reason = "El Resultado de caja firmado no corresponde a este mes.";
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
        const cash = object(currency.caja, "caja");
        const obligations = object(currency.obligaciones, "obligaciones");
        const accumulator = currencies.get(currencyId) ?? {
          currencyId,
          currencyCode,
          grossCollections: 0n,
          ledgerExits: 0n,
          operationalFlow: 0n,
          trainerPayments: 0n,
          refunds: 0n,
          otherOperationalExits: 0n,
          months: [],
        };
        const grossCollections = money(cash.cobros_brutos, "cobros_brutos");
        const ledgerExits = money(cash.salidas_libro, "salidas_libro");
        const operationalFlow = money(cash.flujo_operativo, "flujo_operativo");
        const trainerPayments = money(
          cash.pagos_entrenadores_netos,
          "pagos_entrenadores_netos",
        );
        const refunds = money(cash.reembolsos_netos, "reembolsos_netos");
        const otherOperationalExits = money(
          cash.otros_egresos_operativos,
          "otros_egresos_operativos",
        );
        accumulator.currencyCode = currencyCode;
        accumulator.grossCollections += grossCollections;
        accumulator.ledgerExits += ledgerExits;
        accumulator.operationalFlow += operationalFlow;
        accumulator.trainerPayments += trainerPayments;
        accumulator.refunds += refunds;
        accumulator.otherOperationalExits += otherOperationalExits;
        accumulator.months.push({
          mes: month.month,
          cobros_brutos: treasuryMinorToMoney(grossCollections),
          salidas_libro: treasuryMinorToMoney(ledgerExits),
          flujo_operativo: treasuryMinorToMoney(operationalFlow),
          pagos_entrenadores_netos: treasuryMinorToMoney(trainerPayments),
          reembolsos_netos: treasuryMinorToMoney(refunds),
          otros_egresos_operativos: treasuryMinorToMoney(
            otherOperationalExits,
          ),
          reserva_inmediata: optionalMoney(obligations.reserva_inmediata),
          pagadero_ahora: optionalMoney(
            obligations.entrenador_pagadero_ahora,
          ),
          fondo_futuro: optionalMoney(obligations.entrenador_futuro),
          devoluciones_pendientes: optionalMoney(
            obligations.reembolsos_pendientes,
          ),
          compromiso_total: optionalMoney(obligations.compromiso_total),
        });
        currencies.set(currencyId, accumulator);
      }
    } catch (error) {
      month.status = "SNAPSHOT_INCOMPATIBLE";
      month.reason = error instanceof Error
        ? `El snapshot no cumple el contrato anual: ${error.message}`
        : "El snapshot no cumple el contrato anual.";
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
    naturaleza: "COMPARATIVA_ANUAL_RESULTADO_OPERATIVO_CERTIFICADO",
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
      ? "Todos los meses ya exigibles del año tienen un snapshot R3 certificado."
      : "La comparación usa solo meses certificados; los meses ausentes no se rellenan con cero.",
    limitaciones: [
      "No suma ni convierte monedas diferentes.",
      "Los totales anuales suman flujos mensuales; las reservas muestran únicamente el último corte certificado de cada moneda.",
      "No representa utilidad ni ingreso devengado.",
    ],
  };
}

function annualCurrency(currency: AnnualCurrencyAccumulator) {
  currency.months.sort((a, b) => a.mes.localeCompare(b.mes));
  const byFlow = [...currency.months].sort((a, b) =>
    compareMoney(a.flujo_operativo, b.flujo_operativo)
  );
  const latest = currency.months.length === 0
    ? null
    : currency.months[currency.months.length - 1];
  const highest = byFlow.length === 0 ? null : byFlow[byFlow.length - 1];
  return {
    moneda_id: currency.currencyId,
    moneda_codigo: currency.currencyCode,
    meses_con_datos: currency.months.length,
    totales_flujo: {
      cobros_brutos: treasuryMinorToMoney(currency.grossCollections),
      salidas_libro: treasuryMinorToMoney(currency.ledgerExits),
      flujo_operativo: treasuryMinorToMoney(currency.operationalFlow),
      pagos_entrenadores_netos: treasuryMinorToMoney(currency.trainerPayments),
      reembolsos_netos: treasuryMinorToMoney(currency.refunds),
      otros_egresos_operativos: treasuryMinorToMoney(
        currency.otherOperationalExits,
      ),
    },
    ultimo_corte: latest
      ? {
          mes: latest.mes,
          reserva_inmediata: latest.reserva_inmediata,
          pagadero_ahora: latest.pagadero_ahora,
          fondo_futuro: latest.fondo_futuro,
          devoluciones_pendientes: latest.devoluciones_pendientes,
          compromiso_total: latest.compromiso_total,
        }
      : null,
    mayor_flujo: highest
      ? { mes: highest.mes, monto: highest.flujo_operativo }
      : null,
    menor_flujo: byFlow[0]
      ? { mes: byFlow[0].mes, monto: byFlow[0].flujo_operativo }
      : null,
    meses: currency.months,
  };
}

function removeMonth(
  currencies: Map<string, AnnualCurrencyAccumulator>,
  month: string,
) {
  const empty: string[] = [];
  for (const [currencyId, currency] of currencies) {
    const kept = currency.months.filter((item) => item.mes !== month);
    if (kept.length === currency.months.length) continue;
    currency.grossCollections = 0n;
    currency.ledgerExits = 0n;
    currency.operationalFlow = 0n;
    currency.trainerPayments = 0n;
    currency.refunds = 0n;
    currency.otherOperationalExits = 0n;
    currency.months = kept;
    for (const row of kept) {
      currency.grossCollections += money(row.cobros_brutos, "cobros_brutos");
      currency.ledgerExits += money(row.salidas_libro, "salidas_libro");
      currency.operationalFlow += money(row.flujo_operativo, "flujo_operativo");
      currency.trainerPayments += money(
        row.pagos_entrenadores_netos,
        "pagos_entrenadores_netos",
      );
      currency.refunds += money(row.reembolsos_netos, "reembolsos_netos");
      currency.otherOperationalExits += money(
        row.otros_egresos_operativos,
        "otros_egresos_operativos",
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
    throw new OperationalResultsAnnualPolicyError(
      `${field} no contiene un importe decimal válido.`,
    );
  }
}

function optionalMoney(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  return treasuryMinorToMoney(money(value, "obligación"));
}

function requiredText(value: unknown, field: string) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new OperationalResultsAnnualPolicyError(
      `Falta el campo ${field}.`,
    );
  }
  return text;
}

function object(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationalResultsAnnualPolicyError(
      `${field} no tiene una estructura válida.`,
    );
  }
  return value as JsonRecord;
}

function array(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    throw new OperationalResultsAnnualPolicyError(
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
