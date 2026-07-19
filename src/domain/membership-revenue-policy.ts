import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

export type MembershipFundingKind = "EFECTIVO" | "CREDITO";

export type MembershipFundingSnapshot = {
  kind: MembershipFundingKind;
  amount: string;
  occurredAt: Date;
  createdAt: Date;
  deletedAt: Date | null;
};

export type MembershipPauseRevenueSnapshot = {
  start: Date;
  end: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
};

export type MembershipAdjustmentRevenueSnapshot = {
  type: string;
  effectiveDate: Date;
  unusedAmount: string;
  createdAt: Date;
  deletedAt: Date | null;
};

export type MembershipRevenueSnapshot = {
  membershipId: string;
  clientId: string;
  clientName: string;
  planId: string;
  planName: string;
  currencyId: string;
  currencyCode: string;
  price: string;
  durationDays: number;
  start: Date;
  endExclusive: Date;
  state: string;
  origin: string;
  reconstructed: boolean;
  normalizedLegacyCalendarDates?: boolean;
  createdAt: Date | null;
  funding: MembershipFundingSnapshot[];
  pauses: MembershipPauseRevenueSnapshot[];
  adjustments: MembershipAdjustmentRevenueSnapshot[];
};

export class MembershipRevenuePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipRevenuePolicyError";
  }
}

type MembershipProjection = {
  membershipId: string;
  clientId: string;
  clientName: string;
  planId: string;
  planName: string;
  state: string;
  origin: string;
  priceMinor: bigint;
  fundedMinor: bigint;
  cashFundedInMonthMinor: bigint;
  creditFundedInMonthMinor: bigint;
  earnedInMonthMinor: bigint;
  earnedToCutoffMinor: bigint;
  deferredMinor: bigint;
  reclassifiedUnusedMinor: bigint;
  cancellationAdjustmentMinor: bigint;
  serviceDaysInMonth: number;
  serviceDaysToCutoff: number;
  durationDays: number;
  coverageState: string;
  requiresReview: boolean;
  explanation: string;
};

type CurrencyProjection = {
  currencyId: string;
  currencyCode: string;
  cashFundedInMonth: bigint;
  creditFundedInMonth: bigint;
  earnedInMonth: bigint;
  earnedToCutoff: bigint;
  deferred: bigint;
  reclassifiedUnused: bigint;
  cancellationAdjustment: bigint;
  memberships: MembershipProjection[];
};

const DAY_MS = 86_400_000;

export function buildMembershipRevenueReport(input: {
  month: unknown;
  currentBusinessDate: Date;
  memberships: MembershipRevenueSnapshot[];
}) {
  const period = parseRevenueMonth(input.month);
  const businessDate = calendarDate(input.currentBusinessDate, "El día comercial");
  const businessEndExclusive = addDays(businessDate, 1);
  const currentMonth = businessDate.toISOString().slice(0, 7);
  const future = period.month > currentMonth;
  const cutoffExclusive = future
    ? businessEndExclusive
    : new Date(Math.min(period.endExclusive.getTime(), businessEndExclusive.getTime()));
  const currencies = new Map<string, CurrencyProjection>();
  let excludedWithoutEvidence = 0;
  let requiresReview = 0;
  let considered = 0;

  for (const membership of input.memberships) {
    if (
      membership.createdAt &&
      membership.createdAt.getTime() >= cutoffExclusive.getTime()
    ) continue;
    let projected: MembershipProjection | null;
    try {
      projected = projectMembership(
        membership,
        period.start,
        period.endExclusive,
        cutoffExclusive,
      );
    } catch (error) {
      if (!(error instanceof MembershipRevenuePolicyError)) throw error;
      projected = invalidProjection(membership, error.message);
    }
    if (!projected) continue;
    considered += 1;
    if (projected.coverageState === "SIN_EVIDENCIA_FINANCIERA") {
      excludedWithoutEvidence += 1;
    }
    if (projected.requiresReview) requiresReview += 1;
    const currency = currencies.get(membership.currencyId) ?? {
      currencyId: membership.currencyId,
      currencyCode: membership.currencyCode,
      cashFundedInMonth: 0n,
      creditFundedInMonth: 0n,
      earnedInMonth: 0n,
      earnedToCutoff: 0n,
      deferred: 0n,
      reclassifiedUnused: 0n,
      cancellationAdjustment: 0n,
      memberships: [],
    };
    currency.currencyCode = membership.currencyCode;
    currency.cashFundedInMonth += projected.cashFundedInMonthMinor;
    currency.creditFundedInMonth += projected.creditFundedInMonthMinor;
    currency.earnedInMonth += projected.earnedInMonthMinor;
    currency.earnedToCutoff += projected.earnedToCutoffMinor;
    currency.deferred += projected.deferredMinor;
    currency.reclassifiedUnused += projected.reclassifiedUnusedMinor;
    currency.cancellationAdjustment += projected.cancellationAdjustmentMinor;
    currency.memberships.push(projected);
    currencies.set(membership.currencyId, currency);
  }

  return {
    mes: period.month,
    naturaleza: "INGRESO_DEVENGADO_MEMBRESIAS",
    estado_periodo: future
      ? "FUTURO"
      : period.month === currentMonth
      ? "PROVISIONAL"
      : "HISTORICO_RECALCULADO",
    fecha_corte: future
      ? null
      : new Date(cutoffExclusive.getTime() - DAY_MS).toISOString().slice(0, 10),
    cobertura: {
      membresias_evaluadas: considered,
      sin_evidencia_financiera: excludedWithoutEvidence,
      requieren_revision: requiresReview,
      completa: excludedWithoutEvidence === 0 && requiresReview === 0,
    },
    monedas: [...currencies.values()]
      .map(presentCurrency)
      .sort((left, right) => left.moneda_codigo.localeCompare(right.moneda_codigo)),
    nota:
      "Reconoce el precio financiado durante los días de servicio. No representa utilidad ni flujo de caja.",
    limitaciones: [
      "No mezcla ni convierte monedas.",
      "Los meses históricos son recalculados y todavía no forman parte del snapshot mensual certificado.",
      "El margen requiere incorporar los costos devengados del entrenador y otros gastos.",
    ],
  };
}

function projectMembership(
  membership: MembershipRevenueSnapshot,
  monthStart: Date,
  monthEndExclusive: Date,
  cutoffExclusive: Date,
): MembershipProjection | null {
  const start = calendarDate(membership.start, "El inicio de membresía");
  const end = calendarDate(membership.endExclusive, "El fin de membresía");
  if (!Number.isInteger(membership.durationDays) || membership.durationDays <= 0) {
    throw new MembershipRevenuePolicyError(
      `La membresía ${membership.membershipId} no tiene una duración válida.`,
    );
  }
  if (end.getTime() <= start.getTime()) {
    throw new MembershipRevenuePolicyError(
      `La membresía ${membership.membershipId} no tiene un periodo válido.`,
    );
  }
  if (
    membership.createdAt &&
    membership.createdAt.getTime() >= cutoffExclusive.getTime()
  ) {
    return null;
  }
  const priceMinor = money(membership.price, "precio de membresía");
  if (priceMinor < 0n) {
    throw new MembershipRevenuePolicyError("El precio de membresía no puede ser negativo.");
  }
  const activeFunding = membership.funding.filter((funding) =>
    existedAtCutoff(funding.createdAt, funding.deletedAt, cutoffExclusive)
  );
  const fundedRaw = sum(activeFunding.map((funding) => money(funding.amount, "financiación")));
  const fundedMinor = fundedRaw > priceMinor ? priceMinor : fundedRaw;
  const cashFundedInMonthMinor = fundingInPeriod(
    activeFunding,
    "EFECTIVO",
    monthStart,
    cutoffExclusive,
  );
  const creditFundedInMonthMinor = fundingInPeriod(
    activeFunding,
    "CREDITO",
    monthStart,
    cutoffExclusive,
  );
  const coverageState = fundedRaw === 0n
    ? "SIN_EVIDENCIA_FINANCIERA"
    : fundedRaw < priceMinor
    ? "COBERTURA_PARCIAL"
    : fundedRaw > priceMinor
    ? "COBERTURA_EXCEDIDA"
    : "CUBIERTA";
  if (fundedMinor === 0n) {
    return emptyProjection(
      membership,
      priceMinor,
      fundedMinor,
      cashFundedInMonthMinor,
      creditFundedInMonthMinor,
      coverageState,
    );
  }

  const pauses = membership.pauses
    .filter((pause) =>
      existedAtCutoff(pause.createdAt, pause.deletedAt, cutoffExclusive)
    )
    .map((pause) => ({
      start: calendarDate(pause.start, "El inicio de pausa"),
      end: pause.end ? calendarDate(pause.end, "El fin de pausa") : null,
    }));
  const adjustment = [...membership.adjustments]
    .filter((item) => existedAtCutoff(item.createdAt, item.deletedAt, cutoffExclusive))
    .sort((left, right) => left.effectiveDate.getTime() - right.effectiveDate.getTime())[0]
    ?? null;
  const effectiveEnd = adjustment
    ? calendarDate(adjustment.effectiveDate, "La fecha efectiva del ajuste")
    : end;
  const scheduleEnd = effectiveEnd.getTime() < end.getTime() ? effectiveEnd : end;
  let earnedInMonthMinor = 0n;
  let earnedToCutoffMinor = 0n;
  let serviceDaysInMonth = 0;
  let serviceDaysToCutoff = 0;
  let serviceIndex = 0;
  const enumerationEnd = new Date(
    Math.min(scheduleEnd.getTime(), cutoffExclusive.getTime()),
  );
  for (
    let day = start;
    day.getTime() < enumerationEnd.getTime() && serviceIndex < membership.durationDays;
    day = addDays(day, 1)
  ) {
    if (paused(day, pauses)) continue;
    serviceIndex += 1;
    const amount = serviceDayAmount(fundedMinor, membership.durationDays, serviceIndex);
    earnedToCutoffMinor += amount;
    serviceDaysToCutoff += 1;
    if (
      day.getTime() >= monthStart.getTime() &&
      day.getTime() < monthEndExclusive.getTime()
    ) {
      earnedInMonthMinor += amount;
      serviceDaysInMonth += 1;
    }
  }

  let reclassifiedUnusedMinor = 0n;
  let cancellationAdjustmentMinor = 0n;
  let cancellationApplied = false;
  if (
    adjustment &&
    effectiveEnd.getTime() < cutoffExclusive.getTime()
  ) {
    cancellationApplied = true;
    const unusedRaw = money(adjustment.unusedAmount, "valor no consumido");
    reclassifiedUnusedMinor = unusedRaw > fundedMinor ? fundedMinor : unusedRaw;
    const finalEarned = fundedMinor - reclassifiedUnusedMinor;
    cancellationAdjustmentMinor = finalEarned - earnedToCutoffMinor;
    earnedToCutoffMinor = finalEarned;
    if (
      effectiveEnd.getTime() >= monthStart.getTime() &&
      effectiveEnd.getTime() < monthEndExclusive.getTime()
    ) {
      earnedInMonthMinor += cancellationAdjustmentMinor;
    } else {
      cancellationAdjustmentMinor = 0n;
    }
  }

  const scheduleFinished = serviceDaysToCutoff >= membership.durationDays;
  const deferredMinor = cancellationApplied || scheduleFinished
    ? 0n
    : fundedMinor - earnedToCutoffMinor;
  const shortWithoutAdjustment =
    scheduleEnd.getTime() < cutoffExclusive.getTime() &&
    serviceDaysToCutoff < membership.durationDays &&
    !adjustment;
  const requiresReview =
    coverageState !== "CUBIERTA" || shortWithoutAdjustment ||
    membership.normalizedLegacyCalendarDates === true;
  const baseExplanation = cancellationApplied
    ? "El valor no consumido se reclasificó usando la resolución financiera persistida."
    : shortWithoutAdjustment
    ? "El servicio terminó antes de consumir la duración y no existe un ajuste financiero."
    : coverageState !== "CUBIERTA"
    ? "La financiación evidenciada no coincide con el precio contratado."
    : membership.state === "PAUSADA"
    ? "El reconocimiento se detiene durante la pausa y continúa al reanudar."
    : "El precio se distribuye entre los días efectivos de servicio.";
  const explanation = withLegacyDateNote(baseExplanation, membership);

  return {
    membershipId: membership.membershipId,
    clientId: membership.clientId,
    clientName: membership.clientName,
    planId: membership.planId,
    planName: membership.planName,
    state: membership.state,
    origin: membership.origin,
    priceMinor,
    fundedMinor,
    cashFundedInMonthMinor,
    creditFundedInMonthMinor,
    earnedInMonthMinor,
    earnedToCutoffMinor,
    deferredMinor,
    reclassifiedUnusedMinor,
    cancellationAdjustmentMinor,
    serviceDaysInMonth,
    serviceDaysToCutoff,
    durationDays: membership.durationDays,
    coverageState,
    requiresReview,
    explanation,
  };
}

function emptyProjection(
  membership: MembershipRevenueSnapshot,
  priceMinor: bigint,
  fundedMinor: bigint,
  cashFundedInMonthMinor: bigint,
  creditFundedInMonthMinor: bigint,
  coverageState: string,
): MembershipProjection {
  return {
    membershipId: membership.membershipId,
    clientId: membership.clientId,
    clientName: membership.clientName,
    planId: membership.planId,
    planName: membership.planName,
    state: membership.state,
    origin: membership.origin,
    priceMinor,
    fundedMinor,
    cashFundedInMonthMinor,
    creditFundedInMonthMinor,
    earnedInMonthMinor: 0n,
    earnedToCutoffMinor: 0n,
    deferredMinor: 0n,
    reclassifiedUnusedMinor: 0n,
    cancellationAdjustmentMinor: 0n,
    serviceDaysInMonth: 0,
    serviceDaysToCutoff: 0,
    durationDays: membership.durationDays,
    coverageState,
    requiresReview: true,
    explanation: withLegacyDateNote(
      membership.reconstructed
        ? "La membresía reconstruida no tiene una aplicación financiera verificable."
        : "No existe financiación vigente que permita reconocer ingreso.",
      membership,
    ),
  };
}

function invalidProjection(
  membership: MembershipRevenueSnapshot,
  reason: string,
): MembershipProjection {
  return {
    membershipId: membership.membershipId,
    clientId: membership.clientId,
    clientName: membership.clientName,
    planId: membership.planId,
    planName: membership.planName,
    state: membership.state,
    origin: membership.origin,
    priceMinor: 0n,
    fundedMinor: 0n,
    cashFundedInMonthMinor: 0n,
    creditFundedInMonthMinor: 0n,
    earnedInMonthMinor: 0n,
    earnedToCutoffMinor: 0n,
    deferredMinor: 0n,
    reclassifiedUnusedMinor: 0n,
    cancellationAdjustmentMinor: 0n,
    serviceDaysInMonth: 0,
    serviceDaysToCutoff: 0,
    durationDays:
      Number.isInteger(membership.durationDays) && membership.durationDays > 0
        ? membership.durationDays
        : 0,
    coverageState: "DATOS_CONTRACTUALES_INVALIDOS",
    requiresReview: true,
    explanation: `No se incluyó en los totales: ${reason}`,
  };
}

function withLegacyDateNote(
  explanation: string,
  membership: MembershipRevenueSnapshot,
) {
  return membership.normalizedLegacyCalendarDates
    ? `${explanation} Sus fechas heredadas se normalizaron al día UTC y requieren revisión.`
    : explanation;
}

function presentCurrency(currency: CurrencyProjection) {
  currency.memberships.sort((left, right) =>
    left.clientName.localeCompare(right.clientName) ||
    left.membershipId.localeCompare(right.membershipId)
  );
  return {
    moneda_id: currency.currencyId,
    moneda_codigo: currency.currencyCode,
    financiacion_mes: {
      efectivo_aplicado: treasuryMinorToMoney(currency.cashFundedInMonth),
      credito_aplicado: treasuryMinorToMoney(currency.creditFundedInMonth),
      total_aplicado: treasuryMinorToMoney(
        currency.cashFundedInMonth + currency.creditFundedInMonth,
      ),
    },
    ingreso_devengado_mes: treasuryMinorToMoney(currency.earnedInMonth),
    ingreso_devengado_acumulado: treasuryMinorToMoney(currency.earnedToCutoff),
    saldo_servicio_pendiente: treasuryMinorToMoney(currency.deferred),
    valor_no_consumido_reclasificado: treasuryMinorToMoney(
      currency.reclassifiedUnused,
    ),
    ajuste_cancelacion_mes: treasuryMinorToMoney(currency.cancellationAdjustment),
    membresias: currency.memberships.map((membership) => ({
      membresia_id: membership.membershipId,
      ci: membership.clientId,
      cliente_nombre: membership.clientName,
      plan_id: membership.planId,
      plan_nombre: membership.planName,
      estado: membership.state,
      origen: membership.origin,
      precio: treasuryMinorToMoney(membership.priceMinor),
      financiado: treasuryMinorToMoney(membership.fundedMinor),
      devengado_mes: treasuryMinorToMoney(membership.earnedInMonthMinor),
      devengado_acumulado: treasuryMinorToMoney(membership.earnedToCutoffMinor),
      pendiente_servicio: treasuryMinorToMoney(membership.deferredMinor),
      valor_no_consumido_reclasificado: treasuryMinorToMoney(
        membership.reclassifiedUnusedMinor,
      ),
      ajuste_cancelacion_mes: treasuryMinorToMoney(
        membership.cancellationAdjustmentMinor,
      ),
      dias_servicio_mes: membership.serviceDaysInMonth,
      dias_servicio_acumulados: membership.serviceDaysToCutoff,
      dias_contratados: membership.durationDays,
      cobertura_estado: membership.coverageState,
      requiere_revision: membership.requiresReview,
      explicacion: membership.explanation,
    })),
  };
}

function fundingInPeriod(
  funding: MembershipFundingSnapshot[],
  kind: MembershipFundingKind,
  start: Date,
  endExclusive: Date,
) {
  return sum(funding
    .filter((item) =>
      item.kind === kind &&
      item.occurredAt.getTime() >= start.getTime() &&
      item.occurredAt.getTime() < endExclusive.getTime()
    )
    .map((item) => money(item.amount, "financiación")));
}

function serviceDayAmount(total: bigint, days: number, ordinal: number) {
  const base = total / BigInt(days);
  const remainder = Number(total % BigInt(days));
  return base + (ordinal <= remainder ? 1n : 0n);
}

function paused(
  day: Date,
  pauses: Array<{ start: Date; end: Date | null }>,
) {
  return pauses.some((pause) =>
    day.getTime() >= pause.start.getTime() &&
    (pause.end == null || day.getTime() < pause.end.getTime())
  );
}

function existedAtCutoff(
  createdAt: Date,
  deletedAt: Date | null,
  cutoffExclusive: Date,
) {
  return createdAt.getTime() < cutoffExclusive.getTime() &&
    (deletedAt == null || deletedAt.getTime() >= cutoffExclusive.getTime());
}

function parseRevenueMonth(value: unknown) {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new MembershipRevenuePolicyError("El mes debe usar el formato AAAA-MM.");
  }
  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 7) !== month) {
    throw new MembershipRevenuePolicyError("El mes no es válido.");
  }
  return {
    month,
    start,
    endExclusive: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
  };
}

function calendarDate(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new MembershipRevenuePolicyError(`${label} no es válido.`);
  }
  if (
    value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0 ||
    value.getUTCSeconds() !== 0 || value.getUTCMilliseconds() !== 0
  ) {
    throw new MembershipRevenuePolicyError(`${label} debe ser un día UTC canónico.`);
  }
  return new Date(value.getTime());
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

function money(value: string, label: string) {
  try {
    return treasuryMoneyToMinor(value);
  } catch {
    throw new MembershipRevenuePolicyError(`${label} no contiene un decimal válido.`);
  }
}

function sum(values: bigint[]) {
  return values.reduce((total, value) => total + value, 0n);
}
