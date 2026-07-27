import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

/**
 * R4.6 — Gastos devengados gobernados.
 *
 * Un gasto del gimnasio (alquiler, electricidad, limpieza, mantenimiento,
 * proveedores) pertenece íntegramente a un mes comercial (`periodo_pertenencia_mes`).
 * El devengo reconoce a qué mes pertenece; el pago reconoce cuándo salió el
 * dinero de caja. Ambos conceptos viven separados y nunca se convierten monedas.
 *
 * A diferencia del costo de entrenador, aquí no hay prorrateo por días: si el
 * gasto pertenece a julio, todo su importe se devenga en julio, aunque se pague
 * en junio (pago anticipado) o en agosto (pago atrasado).
 */

export type GovernedExpenseApplicationSnapshot = {
  applicationId?: string;
  expenseId?: string;
  movementId?: string;
  amount: string;
  state: "APLICADA" | "REVERSADA";
  /** Día comercial del movimiento de Tesorería, ya resuelto con Gym.timezone. */
  paidAt: Date;
  /** Instante UTC en que se registró la aplicación. */
  appliedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type GovernedExpenseSnapshot = {
  expenseId: string;
  categoryId: string;
  categoryName: string;
  categoryNature: string;
  supplierId: string | null;
  supplierName: string | null;
  currencyId: string;
  currencyCode: string;
  description: string;
  amount: string;
  belongingMonth: string; // AAAA-MM, mes al que pertenece el gasto
  scheduledDate: Date; // cuándo se espera pagar
  paidAt: Date | null; // cuándo salió el dinero (null si no se ha pagado)
  state: string; // PENDIENTE, PARCIAL, PAGADO, ANULADO
  paidAccumulated: string;
  receiptReference: string | null;
  registeredByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  applications: GovernedExpenseApplicationSnapshot[];
};

export class GovernedExpensePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernedExpensePolicyError";
  }
}

type ProjectedExpense = {
  row: GovernedExpenseSnapshot;
  amount: bigint;
  paidInMonth: bigint;
  paidToCutoff: bigint;
  paidAdvance: bigint; // pagado antes del mes de pertenencia
  paidLate: bigint; // pagado después del mes de pertenencia
  pendingPayment: bigint;
  requiresReview: boolean;
  explanation: string;
};

type CurrencyProjection = {
  currencyId: string;
  currencyCode: string;
  accruedInMonth: bigint; // devengado del mes (gastos que pertenecen al mes)
  paidInMonth: bigint; // pagado en el mes reportado
  paidToCutoff: bigint;
  paidAdvance: bigint;
  paidLate: bigint;
  pendingPayment: bigint;
  expenses: ProjectedExpense[];
};

const DAY_MS = 86_400_000;

export function buildGovernedExpenseReport(input: {
  month: unknown;
  currentBusinessDate: Date;
  expenses: GovernedExpenseSnapshot[];
}) {
  const period = parseMonth(input.month);
  const businessDate = calendarDate(input.currentBusinessDate, "El día comercial");
  const currentMonth = businessDate.toISOString().slice(0, 7);
  const future = period.month > currentMonth;
  const past = period.month < currentMonth;
  const businessEndExclusive = addDays(businessDate, 1);
  // El corte del mes reportado no excede el día comercial actual. Para un mes
  // histórico ya cerrado, el corte es el fin de ese mes (los pagos posteriores
  // al cierre entran como pago atrasado y cuentan en pagado_acumulado). Solo el
  // mes en curso se corta en el día comercial actual para no proyectar pagos
  // futuros.
  const cutoffExclusive = future || past
    ? period.endExclusive
    : new Date(Math.min(period.endExclusive.getTime(), businessEndExclusive.getTime()));
  const currencies = new Map<string, CurrencyProjection>();
  let evaluated = 0;
  let review = 0;
  let pendingCount = 0;

  // Orden estable: por mes de pertenencia, luego categoría, luego descripción.
  const sorted = [...input.expenses].sort((left, right) =>
    left.belongingMonth.localeCompare(right.belongingMonth) ||
    left.categoryName.localeCompare(right.categoryName) ||
    left.description.localeCompare(right.description) ||
    left.expenseId.localeCompare(right.expenseId)
  );

  for (const row of sorted) {
    try {
      const amount = money(row.amount, "importe del gasto");
      if (amount <= 0n) {
        throw new GovernedExpensePolicyError(
          `El gasto ${row.expenseId} debe tener un importe positivo.`,
        );
      }
      calendarDate(row.scheduledDate, "La fecha programada del gasto");
      if (row.paidAt) calendarDate(row.paidAt, "La fecha de pago del gasto");
      // Un gasto creado después del corte no entró todavía al dominio.
      if (row.createdAt.getTime() >= cutoffExclusive.getTime()) continue;
      // Un gasto anulado antes del corte no aporta al devengo del mes.
      if (
        row.state === "ANULADO" &&
        row.updatedAt.getTime() < cutoffExclusive.getTime()
      ) continue;

      const belongsToMonth = row.belongingMonth === period.month;
      // Las aplicaciones que cuentan para el reporte. Para el mes en curso no
      // se incluyen pagos futuros (posteriores al día comercial); para un mes
      // histórico o futuro todas las aplicaciones APLICADA cuentan porque el
      // snapshot ya es una fotografía actual de la base de datos.
      const inProgress = !future && !past;
      const paidApplications = effectiveApplications(
        row.applications,
        inProgress,
        cutoffExclusive,
      );
      const { paidInMonth, paidAdvance, paidLate, paidToCutoff } = classifyPayments(
        paidApplications,
        period,
        cutoffExclusive,
      );
      const paidAccumulated = sumApplied(paidApplications);
      const pendingPayment = clampNegative(amount - paidAccumulated);

      evaluated += 1;
      if (row.state === "PENDIENTE" || row.state === "PARCIAL") pendingCount += 1;

      // Solo los gastos que pertenecen al mes aportan al devengo del mes.
      // Los pagos de meses anteriores o posteriores que caigan en el mes
      // reportado se muestran como flujo de caja, no como devengo.
      const requiresReview = !belongsToMonth && (paidInMonth > 0n);
      if (requiresReview) review += 1;

      const currency = currencies.get(row.currencyId) ?? {
        currencyId: row.currencyId,
        currencyCode: row.currencyCode,
        accruedInMonth: 0n,
        paidInMonth: 0n,
        paidToCutoff: 0n,
        paidAdvance: 0n,
        paidLate: 0n,
        pendingPayment: 0n,
        expenses: [],
      };
      currency.currencyCode = row.currencyCode;
      if (belongsToMonth) {
        currency.accruedInMonth += amount;
        currency.pendingPayment += pendingPayment;
      }
      currency.paidInMonth += paidInMonth;
      currency.paidToCutoff += paidToCutoff;
      currency.paidAdvance += paidAdvance;
      currency.paidLate += paidLate;
      currency.expenses.push({
        row,
        amount,
        paidInMonth,
        paidToCutoff,
        paidAdvance,
        paidLate,
        pendingPayment,
        requiresReview,
        explanation: explain(row, belongsToMonth, paidApplications, pendingPayment),
      });
      currencies.set(row.currencyId, currency);
    } catch (error) {
      if (error instanceof GovernedExpensePolicyError) throw error;
      throw new GovernedExpensePolicyError(
        `El gasto ${row.expenseId} no pudo proyectarse: ${error instanceof Error ? error.message : "error desconocido"}.`,
      );
    }
  }

  return {
    mes: period.month,
    naturaleza: "GASTO_DEVENGADO_GOBERNADO",
    estado_periodo: future
      ? "FUTURO"
      : period.month === currentMonth
      ? "PROVISIONAL"
      : "HISTORICO_RECALCULADO",
    fecha_corte: future
      ? null
      : new Date(cutoffExclusive.getTime() - DAY_MS).toISOString().slice(0, 10),
    cobertura: {
      gastos_evaluados: evaluated,
      requieren_revision: review,
      gastos_pendientes_pago: pendingCount,
      completa: review === 0,
    },
    monedas: [...currencies.values()]
      .map(presentCurrency)
      .sort((left, right) => left.moneda_codigo.localeCompare(right.moneda_codigo)),
    nota:
      "Separa el gasto que pertenece al mes (devengado) del dinero que salió de caja (pago). " +
      "Un pago anticipado o atrasado no cambia el mes al que pertenece el gasto.",
    limitaciones: [
      "No mezcla ni convierte monedas.",
      "Cada gasto pertenece íntegramente a un mes; no hay prorrateo por días.",
      "Los meses históricos son reconstrucciones provisionales hasta incorporarse a un cierre certificado.",
    ],
  };
}

function presentCurrency(currency: CurrencyProjection) {
  return {
    moneda_id: currency.currencyId,
    moneda_codigo: currency.currencyCode,
    devengado_mes: treasuryMinorToMoney(currency.accruedInMonth),
    pagado_mes: treasuryMinorToMoney(currency.paidInMonth),
    pagado_acumulado: treasuryMinorToMoney(currency.paidToCutoff),
    pago_anticipado: treasuryMinorToMoney(currency.paidAdvance),
    pago_atrasado: treasuryMinorToMoney(currency.paidLate),
    pendiente_pago: treasuryMinorToMoney(currency.pendingPayment),
    gastos: currency.expenses.map((expense) => ({
      gasto_id: expense.row.expenseId,
      categoria_id: expense.row.categoryId,
      categoria_nombre: expense.row.categoryName,
      categoria_naturaleza: expense.row.categoryNature,
      proveedor_id: expense.row.supplierId,
      proveedor_nombre: expense.row.supplierName,
      moneda_id: expense.row.currencyId,
      moneda_codigo: expense.row.currencyCode,
      descripcion: expense.row.description,
      mes_pertenencia: expense.row.belongingMonth,
      fecha_programada: expense.row.scheduledDate.toISOString(),
      fecha_pago: expense.row.paidAt?.toISOString() ?? null,
      estado: expense.row.state,
      importe: treasuryMinorToMoney(expense.amount),
      pagado_acumulado: treasuryMinorToMoney(expense.paidToCutoff),
      pagado_mes: treasuryMinorToMoney(expense.paidInMonth),
      pendiente_pago: treasuryMinorToMoney(expense.pendingPayment),
      comprobante_referencia: expense.row.receiptReference,
      requiere_revision: expense.requiresReview,
      explicacion: expense.explanation,
      aplicaciones: expense.row.applications.map((application) => ({
        aplicacion_id: application.applicationId ?? "",
        gasto_id: application.expenseId ?? expense.row.expenseId,
        movimiento_id: application.movementId ?? null,
        monto_aplicado: application.amount,
        estado: application.state,
        fecha_negocio: application.paidAt.toISOString(),
        aplicada_at: (application.appliedAt ?? application.createdAt).toISOString(),
      })),
    })),
  };
}

function explain(
  row: GovernedExpenseSnapshot,
  belongsToMonth: boolean,
  applications: GovernedExpenseApplicationSnapshot[],
  pendingPayment: bigint,
) {
  const applied = sumApplied(applications);
  if (row.state === "ANULADO") {
    return "Gasto anulado; no aporta al devengo del mes.";
  }
  if (!belongsToMonth) {
    return `Pertenece a ${row.belongingMonth}; se muestra como flujo de caja del mes, no como devengo.`;
  }
  if (applied === 0n) {
    return "Pertenece al mes y está pendiente de pago.";
  }
  if (pendingPayment === 0n) {
    return "Pertenece al mes y está totalmente pagado.";
  }
  return "Pertenece al mes con pago parcial; resta saldar el pendiente.";
}

function effectiveApplications(
  applications: GovernedExpenseApplicationSnapshot[],
  inProgress: boolean,
  cutoffExclusive: Date,
) {
  return applications
    .filter((app) => app.state === "APLICADA")
    // Solo para el mes en curso se excluyen pagos posteriores al día comercial.
    // Un mes histórico o futuro ya es una fotografía cerrada: todas las
    // aplicaciones APLICADA cuentan.
    .filter((app) => !inProgress || app.createdAt.getTime() < cutoffExclusive.getTime());
}

function classifyPayments(
  applications: GovernedExpenseApplicationSnapshot[],
  period: { start: Date; endExclusive: Date; month: string },
  cutoffExclusive: Date,
) {
  let paidInMonth = 0n;
  let paidAdvance = 0n;
  let paidLate = 0n;
  let paidToCutoff = 0n;
  for (const app of applications) {
    const amount = money(app.amount, "monto aplicado");
    paidToCutoff += amount;
    const day = calendarDate(app.paidAt, "La fecha del pago aplicado");
    if (day.getTime() < period.start.getTime()) {
      paidAdvance += amount;
    } else if (day.getTime() >= period.endExclusive.getTime()) {
      paidLate += amount;
    } else if (day.getTime() < cutoffExclusive.getTime()) {
      paidInMonth += amount;
    } else {
      // Dentro del mes pero después del corte (mes en curso): cuenta como
      // pagado acumulado pero no entra al pagado_mes del corte.
      paidLate += amount;
    }
  }
  return { paidInMonth, paidAdvance, paidLate, paidToCutoff };
}

function sumApplied(applications: GovernedExpenseApplicationSnapshot[]) {
  let total = 0n;
  for (const app of applications) {
    if (app.state !== "APLICADA") continue;
    total += money(app.amount, "monto aplicado");
  }
  return total;
}

function clampNegative(value: bigint) {
  return value < 0n ? 0n : value;
}

function money(value: unknown, field: string) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new GovernedExpensePolicyError(`Falta el campo ${field}.`);
  }
  try {
    return treasuryMoneyToMinor(text);
  } catch {
    throw new GovernedExpensePolicyError(
      `${field} no contiene un importe decimal válido.`,
    );
  }
}

function parseMonth(value: unknown) {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new GovernedExpensePolicyError(
      "El mes debe usar el formato AAAA-MM.",
    );
  }
  const [year, monthPart] = month.split("-").map(Number);
  if (monthPart < 1 || monthPart > 12) {
    throw new GovernedExpensePolicyError("El mes debe estar entre 01 y 12.");
  }
  const start = new Date(Date.UTC(year, monthPart - 1, 1));
  const endExclusive = new Date(Date.UTC(year, monthPart, 1));
  return { month, start, endExclusive };
}

function calendarDate(value: unknown, label: string) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) {
    throw new GovernedExpensePolicyError(`${label} no es una fecha válida.`);
  }
  // Exige día UTC canónico (00:00:00Z) para fechas contractuales/de negocio.
  if (
    date.getUTCHours() !== 0 ||
    date.getUTCMinutes() !== 0 ||
    date.getUTCSeconds() !== 0 ||
    date.getUTCMilliseconds() !== 0
  ) {
    throw new GovernedExpensePolicyError(
      `${label} debe ser un día UTC canónico (00:00:00Z).`,
    );
  }
  return date;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}
