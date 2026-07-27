import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

/**
 * R4.6 — Resultado operativo devengado.
 *
 * Cierra la cadena del devengo: el margen gerencial (R4.3) ya resta al ingreso
 * devengado el costo directo de comisión y separa la compensación fija; aquí se
 * resta además el gasto gobernado que pertenece al mes (R4.6) para llegar al
 * resultado operativo del período.
 *
 *   ingreso devengado
 *   − costo directo de comisión      → margen directo        (R4.3)
 *   − compensación fija              → margen menos fijo     (R4.3)
 *   − gasto devengado gobernado      → resultado operativo   (R4.6)
 *
 * Sigue sin ser utilidad contable: faltan impuestos, depreciación, préstamos y
 * asientos de doble partida. El nombre del resultado lo dice explícitamente.
 *
 * La política es pura: recibe el informe de margen y el de gastos ya
 * construidos por sus propias políticas y los compone. No relee la base de
 * datos ni reinterpreta el devengo de ninguno de los dos.
 */

export class AccrualOperatingResultPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccrualOperatingResultPolicyError";
  }
}

/** Naturalezas de gasto que el catálogo gobernado reconoce. */
const KNOWN_NATURES = ["OPERATIVO", "ADMINISTRATIVO", "COSTO_VENTAS"] as const;
type KnownNature = (typeof KNOWN_NATURES)[number];

type NatureBucket = {
  nature: string;
  accrued: bigint;
  count: number;
};

type CurrencyBucket = {
  currencyId: string;
  currencyCode: string;
  marginMonth: bigint;
  marginAfterFixedMonth: bigint;
  revenueMonth: bigint;
  directCostMonth: bigint;
  fixedMonth: bigint;
  expenseMonth: bigint;
  expensePendingPayment: bigint;
  expensePaidMonth: bigint;
  natures: Map<string, NatureBucket>;
  hasMargin: boolean;
  hasExpense: boolean;
};

export function buildAccrualOperatingResult(input: {
  margin: Record<string, any>;
  expenses: Record<string, any>;
}) {
  const margin = requireReport(input.margin, "margen gerencial");
  const expenses = requireReport(input.expenses, "gasto devengado gobernado");
  const month = requireMonth(margin.mes, "El mes del margen gerencial");
  const expenseMonth = requireMonth(
    expenses.mes,
    "El mes del informe de gastos",
  );
  if (month !== expenseMonth) {
    throw new AccrualOperatingResultPolicyError(
      `El margen gerencial (${month}) y el gasto devengado (${expenseMonth}) deben pertenecer al mismo mes.`,
    );
  }

  const currencies = new Map<string, CurrencyBucket>();

  for (const row of asArray(margin.monedas, "monedas del margen gerencial")) {
    const bucket = currencyBucket(currencies, row, "margen gerencial");
    bucket.revenueMonth = money(row.ingreso_devengado_mes, "ingreso devengado del mes");
    bucket.directCostMonth = money(row.costo_directo_mes, "costo directo del mes");
    bucket.marginMonth = money(row.margen_directo_mes, "margen directo del mes");
    bucket.fixedMonth = money(
      row.fijo_no_distribuido_mes,
      "fijo no distribuido del mes",
    );
    bucket.marginAfterFixedMonth = money(
      row.margen_menos_fijo_mes,
      "margen menos fijo del mes",
    );
    bucket.hasMargin = true;
  }

  for (const row of asArray(expenses.monedas, "monedas del informe de gastos")) {
    const bucket = currencyBucket(currencies, row, "informe de gastos");
    bucket.expenseMonth = money(row.devengado_mes, "gasto devengado del mes");
    bucket.expensePendingPayment = money(
      row.pendiente_pago,
      "gasto pendiente de pago",
    );
    bucket.expensePaidMonth = money(row.pagado_mes, "gasto pagado en el mes");
    bucket.hasExpense = true;

    // El desglose por naturaleza solo considera los gastos que pertenecen al
    // mes. El informe de gastos también lista pagos de otros meses como flujo
    // de caja; esos no devengan aquí.
    let natureTotal = 0n;
    for (const expense of asArray(row.gastos, "gastos del informe")) {
      if (String(expense.mes_pertenencia ?? "") !== month) continue;
      if (String(expense.estado ?? "") === "ANULADO") continue;
      const amount = money(expense.importe, "importe del gasto");
      const nature = normalizeNature(expense.categoria_naturaleza);
      const entry = bucket.natures.get(nature) ??
        { nature, accrued: 0n, count: 0 };
      entry.accrued += amount;
      entry.count += 1;
      bucket.natures.set(nature, entry);
      natureTotal += amount;
    }
    // Invariante: el desglose por naturaleza debe reconstruir el devengado que
    // la política de gastos ya calculó. Si difieren, alguien cambió una de las
    // dos políticas sin la otra y el resultado sería una cifra inventada.
    if (natureTotal !== bucket.expenseMonth) {
      throw new AccrualOperatingResultPolicyError(
        `El desglose por naturaleza de ${bucket.currencyCode} suma ${treasuryMinorToMoney(natureTotal)} y el gasto devengado del mes es ${treasuryMinorToMoney(bucket.expenseMonth)}.`,
      );
    }
  }

  const presented = [...currencies.values()]
    .map(presentCurrency)
    .sort((left, right) => left.moneda_codigo.localeCompare(right.moneda_codigo));

  const marginCoverage = asRecord(margin.cobertura);
  const expenseCoverage = asRecord(expenses.cobertura);
  // La única fuente de "revisión" del informe de gastos es un gasto de otro mes
  // pagado dentro de este mes (pagar en julio el alquiler de junio). Eso es
  // operación normal y por construcción no entra al devengado del mes, así que
  // no vuelve incompleta la cobertura: se informa aparte.
  const crossMonthPayments = integer(expenseCoverage.requieren_revision);
  const complete = marginCoverage.completa === true;

  return {
    mes: month,
    naturaleza: "RESULTADO_OPERATIVO_DEVENGADO",
    estado_periodo: String(margin.estado_periodo ?? expenses.estado_periodo ?? ""),
    fecha_corte: margin.fecha_corte ?? expenses.fecha_corte ?? null,
    cobertura: {
      membresias_evaluadas: integer(marginCoverage.membresias_evaluadas),
      conceptos_costo_evaluados: integer(marginCoverage.conceptos_costo_evaluados),
      gastos_evaluados: integer(expenseCoverage.gastos_evaluados),
      gastos_pendientes_pago: integer(expenseCoverage.gastos_pendientes_pago),
      gastos_de_otro_mes_pagados_en_el_mes: crossMonthPayments,
      requieren_revision: integer(marginCoverage.requieren_revision),
      completa: complete,
    },
    monedas: presented,
    margen_gerencial: margin,
    gasto_devengado: expenses,
    nota:
      "Resta al margen gerencial (ya neto de compensación fija) el gasto gobernado que pertenece al mes. " +
      "Es el resultado operativo del período, no la utilidad del gimnasio.",
    limitaciones: [
      "No mezcla ni convierte monedas.",
      "No incluye impuestos, depreciación, préstamos ni asientos de doble partida; no es utilidad fiscal ni contable.",
      "El gasto de naturaleza COSTO_VENTAS se muestra por separado y no se reclasifica dentro del costo directo de comisión sin una regla aprobada por dirección.",
      "Solo se calcula el resultado del mes: el margen acumula sobre la vida de la membresía y el gasto sobre el mes de pertenencia, así que sumar ambos acumulados compararía bases distintas.",
      "Un gasto de otro mes pagado dentro de este mes se informa aparte y no altera el devengado del período; solo mueve caja.",
      "Los meses históricos son reconstrucciones provisionales hasta incorporarse a un cierre certificado.",
    ],
  };
}

function presentCurrency(bucket: CurrencyBucket) {
  const result = bucket.marginAfterFixedMonth - bucket.expenseMonth;
  const natures = [...bucket.natures.values()].sort((left, right) =>
    natureOrder(left.nature) - natureOrder(right.nature) ||
    left.nature.localeCompare(right.nature)
  );
  return {
    moneda_id: bucket.currencyId,
    moneda_codigo: bucket.currencyCode,
    ingreso_devengado_mes: treasuryMinorToMoney(bucket.revenueMonth),
    costo_directo_mes: treasuryMinorToMoney(bucket.directCostMonth),
    margen_directo_mes: treasuryMinorToMoney(bucket.marginMonth),
    fijo_no_distribuido_mes: treasuryMinorToMoney(bucket.fixedMonth),
    margen_menos_fijo_mes: treasuryMinorToMoney(bucket.marginAfterFixedMonth),
    gasto_devengado_mes: treasuryMinorToMoney(bucket.expenseMonth),
    gasto_pagado_mes: treasuryMinorToMoney(bucket.expensePaidMonth),
    gasto_pendiente_pago: treasuryMinorToMoney(bucket.expensePendingPayment),
    resultado_operativo_devengado_mes: treasuryMinorToMoney(result),
    resultado_operativo_pct_ingreso_mes: percent(result, bucket.revenueMonth),
    gasto_por_naturaleza: natures.map((entry) => ({
      naturaleza: entry.nature,
      gastos: entry.count,
      devengado_mes: treasuryMinorToMoney(entry.accrued),
      pct_ingreso_mes: percent(entry.accrued, bucket.revenueMonth),
    })),
    // Una moneda con gasto pero sin ingreso devengado no es un error: el
    // operador debe verla para entender por qué el resultado es negativo.
    solo_gasto: !bucket.hasMargin && bucket.hasExpense,
    explicacion: explain(bucket, result),
  };
}

function explain(bucket: CurrencyBucket, result: bigint) {
  if (!bucket.hasMargin && bucket.hasExpense) {
    return "Hay gasto devengado en esta moneda pero ningún ingreso devengado del mes; el resultado es enteramente negativo.";
  }
  if (bucket.expenseMonth === 0n) {
    return "Sin gasto gobernado que pertenezca al mes; el resultado coincide con el margen menos el fijo.";
  }
  if (result < 0n) {
    return "El gasto gobernado del mes supera al margen ya neto de compensación fija.";
  }
  return "El margen del mes cubre la compensación fija y el gasto gobernado del período.";
}

function currencyBucket(
  currencies: Map<string, CurrencyBucket>,
  row: Record<string, any>,
  source: string,
) {
  const currencyId = String(row?.moneda_id ?? "").trim();
  if (!currencyId) {
    throw new AccrualOperatingResultPolicyError(
      `Una moneda del ${source} no trae identificador.`,
    );
  }
  const bucket = currencies.get(currencyId) ?? {
    currencyId,
    currencyCode: "—",
    marginMonth: 0n,
    marginAfterFixedMonth: 0n,
    revenueMonth: 0n,
    directCostMonth: 0n,
    fixedMonth: 0n,
    expenseMonth: 0n,
    expensePendingPayment: 0n,
    expensePaidMonth: 0n,
    natures: new Map<string, NatureBucket>(),
    hasMargin: false,
    hasExpense: false,
  };
  const code = String(row?.moneda_codigo ?? "").trim();
  if (code && code !== "—") bucket.currencyCode = code;
  currencies.set(currencyId, bucket);
  return bucket;
}

function normalizeNature(value: unknown) {
  const nature = String(value ?? "").trim().toUpperCase();
  if (!nature) return "SIN_NATURALEZA";
  return (KNOWN_NATURES as readonly string[]).includes(nature)
    ? (nature as KnownNature)
    : nature;
}

function natureOrder(nature: string) {
  const index = (KNOWN_NATURES as readonly string[]).indexOf(nature);
  return index < 0 ? KNOWN_NATURES.length : index;
}

function percent(part: bigint, total: bigint) {
  if (total <= 0n) return null;
  // Dos decimales, calculados en enteros para no arrastrar coma flotante.
  const scaled = (part * 10000n) / total;
  return Number(scaled) / 100;
}

function money(value: unknown, field: string) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new AccrualOperatingResultPolicyError(`Falta el campo ${field}.`);
  }
  try {
    return treasuryMoneyToMinor(text);
  } catch {
    throw new AccrualOperatingResultPolicyError(
      `${field} no contiene un importe decimal válido.`,
    );
  }
}

function requireReport(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AccrualOperatingResultPolicyError(
      `Falta el informe de ${label} para componer el resultado devengado.`,
    );
  }
  return value as Record<string, any>;
}

function requireMonth(value: unknown, label: string) {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new AccrualOperatingResultPolicyError(
      `${label} debe usar el formato AAAA-MM.`,
    );
  }
  return month;
}

function asArray(value: unknown, label: string) {
  if (value == null) return [] as Record<string, any>[];
  if (!Array.isArray(value)) {
    throw new AccrualOperatingResultPolicyError(
      `Las ${label} deben venir en una lista.`,
    );
  }
  return value as Record<string, any>[];
}

function asRecord(value: unknown) {
  return (value && typeof value === "object" ? value : {}) as Record<string, any>;
}

function integer(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}
