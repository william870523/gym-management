import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

/**
 * R4.7 — Gastos recurrentes.
 *
 * Una plantilla recurrente **no es un gasto**: es la instrucción de crear uno
 * cada mes (alquiler, electricidad, limpieza). El gasto real solo existe cuando
 * se genera, para que nadie devengue un mes que todavía no ocurrió.
 *
 * Esta política decide, para un mes dado, qué plantillas generan gasto y cuáles
 * se saltan y por qué. Es pura: recibe las plantillas y lo ya generado, y
 * devuelve un plan. No escribe nada; quien escribe es el servicio, y lo hace con
 * el mismo camino que un gasto manual (bloqueo de mes y eventos de sync
 * incluidos).
 */

export class RecurringExpensePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurringExpensePolicyError";
  }
}

export type RecurringExpenseTemplateSnapshot = {
  templateId: string;
  categoryId: string;
  categoryName: string;
  supplierId: string | null;
  supplierName: string | null;
  currencyId: string;
  currencyCode: string;
  description: string;
  amount: string;
  /** Día del mes de la fecha programada de pago (1-28). */
  scheduledDay: number;
  startMonth: string; // AAAA-MM
  endMonth: string | null; // AAAA-MM inclusive
  active: boolean;
  notes: string | null;
};

/** Gasto ya generado por una plantilla para un mes concreto. */
export type RecurringExpenseGeneratedSnapshot = {
  templateId: string;
  month: string;
  expenseId: string;
};

export type RecurringSkipReason =
  | "YA_GENERADO"
  | "INACTIVA"
  | "ANTES_DE_VIGENCIA"
  | "DESPUES_DE_VIGENCIA";

/** Día máximo admitido: existe en todos los meses, también en febrero. */
export const MAX_SCHEDULED_DAY = 28;

export function planRecurringExpenseGeneration(input: {
  month: unknown;
  currentBusinessDate: Date;
  templates: RecurringExpenseTemplateSnapshot[];
  generated: RecurringExpenseGeneratedSnapshot[];
}) {
  const month = parseMonth(input.month, "El mes de generación");
  const businessDate = calendarDate(
    input.currentBusinessDate,
    "El día comercial",
  );
  const currentMonth = businessDate.toISOString().slice(0, 7);
  const future = month > currentMonth;

  const generatedByTemplate = new Map<string, string>();
  for (const row of input.generated) {
    if (row.month !== month) continue;
    generatedByTemplate.set(row.templateId, row.expenseId);
  }

  const pending: ReturnType<typeof presentPending>[] = [];
  const skipped: ReturnType<typeof presentSkipped>[] = [];
  const totals = new Map<string, { code: string; amount: bigint }>();

  const sorted = [...input.templates].sort((left, right) =>
    left.categoryName.localeCompare(right.categoryName) ||
    left.description.localeCompare(right.description) ||
    left.templateId.localeCompare(right.templateId)
  );

  for (const template of sorted) {
    const amount = money(template.amount, "importe de la plantilla");
    if (amount <= 0n) {
      throw new RecurringExpensePolicyError(
        `La plantilla ${template.templateId} debe tener un importe positivo.`,
      );
    }
    const day = scheduledDay(template);
    parseMonth(template.startMonth, "El mes de inicio de la plantilla");
    if (template.endMonth) {
      const end = parseMonth(
        template.endMonth,
        "El mes de término de la plantilla",
      );
      if (end < template.startMonth) {
        throw new RecurringExpensePolicyError(
          `La plantilla ${template.templateId} termina antes de empezar.`,
        );
      }
    }

    const alreadyGenerated = generatedByTemplate.get(template.templateId);
    if (alreadyGenerated) {
      skipped.push(
        presentSkipped(template, "YA_GENERADO", alreadyGenerated),
      );
      continue;
    }
    if (!template.active) {
      skipped.push(presentSkipped(template, "INACTIVA", null));
      continue;
    }
    if (month < template.startMonth) {
      skipped.push(presentSkipped(template, "ANTES_DE_VIGENCIA", null));
      continue;
    }
    if (template.endMonth && month > template.endMonth) {
      skipped.push(presentSkipped(template, "DESPUES_DE_VIGENCIA", null));
      continue;
    }

    pending.push(presentPending(template, month, day, amount));
    const bucket = totals.get(template.currencyId) ??
      { code: template.currencyCode, amount: 0n };
    bucket.code = template.currencyCode;
    bucket.amount += amount;
    totals.set(template.currencyId, bucket);
  }

  return {
    mes: month,
    naturaleza: "GENERACION_GASTO_RECURRENTE",
    estado_periodo: future
      ? "FUTURO"
      : month === currentMonth
      ? "EN_CURSO"
      : "HISTORICO",
    // Un mes futuro no se genera: el gasto pertenecería a un período que aún no
    // ocurrió y ensuciaría el devengo. Un mes pasado sí, por si se olvidó.
    puede_generar: !future && pending.length > 0,
    motivo_bloqueo: future
      ? "No se genera un mes futuro: el gasto pertenecería a un período que todavía no ocurrió."
      : pending.length === 0
      ? "No hay ninguna plantilla pendiente de generar para este mes."
      : null,
    resumen: {
      plantillas_evaluadas: input.templates.length,
      a_generar: pending.length,
      omitidas: skipped.length,
      ya_generadas: skipped.filter((row) => row.motivo === "YA_GENERADO").length,
    },
    a_generar: pending,
    omitidas: skipped,
    totales_por_moneda: [...totals.entries()]
      .map(([currencyId, bucket]) => ({
        moneda_id: currencyId,
        moneda_codigo: bucket.code,
        importe: treasuryMinorToMoney(bucket.amount),
      }))
      .sort((left, right) => left.moneda_codigo.localeCompare(right.moneda_codigo)),
    nota:
      "La plantilla describe un gasto que se repite; el gasto solo existe cuando se genera. " +
      "Generar dos veces el mismo mes no duplica nada.",
    limitaciones: [
      "No mezcla ni convierte monedas.",
      "Cada plantilla genera como mucho un gasto por mes de pertenencia.",
      "El importe generado es el de la plantilla en ese momento; cambiarlo después no reescribe los gastos ya generados.",
      "El gasto generado nace pendiente de pago: la recurrencia no paga nada por su cuenta.",
    ],
  };
}

function presentPending(
  template: RecurringExpenseTemplateSnapshot,
  month: string,
  day: number,
  amount: bigint,
) {
  return {
    recurrente_id: template.templateId,
    categoria_id: template.categoryId,
    categoria_nombre: template.categoryName,
    proveedor_id: template.supplierId,
    proveedor_nombre: template.supplierName,
    moneda_id: template.currencyId,
    moneda_codigo: template.currencyCode,
    descripcion: template.description,
    importe: treasuryMinorToMoney(amount),
    mes_pertenencia: month,
    fecha_programada: `${month}-${String(day).padStart(2, "0")}`,
    explicacion: "Pertenece al mes y todavía no se generó.",
  };
}

function presentSkipped(
  template: RecurringExpenseTemplateSnapshot,
  reason: RecurringSkipReason,
  expenseId: string | null,
) {
  return {
    recurrente_id: template.templateId,
    descripcion: template.description,
    categoria_nombre: template.categoryName,
    moneda_codigo: template.currencyCode,
    motivo: reason,
    gasto_id: expenseId,
    explicacion: explainSkip(template, reason),
  };
}

function explainSkip(
  template: RecurringExpenseTemplateSnapshot,
  reason: RecurringSkipReason,
) {
  switch (reason) {
    case "YA_GENERADO":
      return "Ya existe el gasto de este mes para esta plantilla.";
    case "INACTIVA":
      return "La plantilla está desactivada; no genera hasta reactivarla.";
    case "ANTES_DE_VIGENCIA":
      return `La plantilla empieza en ${template.startMonth}.`;
    case "DESPUES_DE_VIGENCIA":
      return `La plantilla terminó en ${template.endMonth}.`;
  }
}

function scheduledDay(template: RecurringExpenseTemplateSnapshot) {
  const day = Number(template.scheduledDay);
  if (!Number.isInteger(day) || day < 1 || day > MAX_SCHEDULED_DAY) {
    throw new RecurringExpensePolicyError(
      `El día programado de la plantilla ${template.templateId} debe estar entre 1 y ${MAX_SCHEDULED_DAY}.`,
    );
  }
  return day;
}

function money(value: unknown, field: string) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new RecurringExpensePolicyError(`Falta el campo ${field}.`);
  }
  try {
    return treasuryMoneyToMinor(text);
  } catch {
    throw new RecurringExpensePolicyError(
      `${field} no contiene un importe decimal válido.`,
    );
  }
}

function parseMonth(value: unknown, label: string) {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new RecurringExpensePolicyError(`${label} debe usar el formato AAAA-MM.`);
  }
  const monthPart = Number(month.slice(5, 7));
  if (monthPart < 1 || monthPart > 12) {
    throw new RecurringExpensePolicyError(`${label} debe estar entre 01 y 12.`);
  }
  return month;
}

function calendarDate(value: unknown, label: string) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) {
    throw new RecurringExpensePolicyError(`${label} no es una fecha válida.`);
  }
  if (
    date.getUTCHours() !== 0 ||
    date.getUTCMinutes() !== 0 ||
    date.getUTCSeconds() !== 0 ||
    date.getUTCMilliseconds() !== 0
  ) {
    throw new RecurringExpensePolicyError(
      `${label} debe ser un día UTC canónico (00:00:00Z).`,
    );
  }
  return date;
}
