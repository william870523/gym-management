import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

export type TrainerServiceCostSource = "COMISION" | "FIJO";

export type TrainerServiceCostApplicationSnapshot = {
  amount: string;
  state: "APLICADA" | "REVERSADA";
  createdAt: Date;
  updatedAt: Date;
};

export type TrainerServiceCostPauseSnapshot = {
  start: Date;
  end: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
};

export type TrainerServiceCostSnapshot = {
  costId: string;
  groupId: string;
  source: TrainerServiceCostSource;
  trainerId: string;
  trainerName: string;
  membershipId: string | null;
  clientId: string | null;
  clientName: string | null;
  planId: string | null;
  planName: string | null;
  currencyId: string;
  currencyCode: string;
  total: string;
  earningMethod: string;
  periodStart: Date;
  periodEnd: Date;
  scheduledDate: Date;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  normalizedLegacyCalendarDates?: boolean;
  applications: TrainerServiceCostApplicationSnapshot[];
  pauses: TrainerServiceCostPauseSnapshot[];
};

export class TrainerServiceCostPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrainerServiceCostPolicyError";
  }
}

type ProjectedCost = {
  row: TrainerServiceCostSnapshot;
  total: bigint;
  earnedInMonth: bigint;
  earnedToCutoff: bigint;
  paidInMonth: bigint;
  paidToCutoff: bigint;
  earnedPending: bigint;
  futureCommitted: bigint;
  paidAdvance: bigint;
  serviceDaysInMonth: number;
  serviceDaysToCutoff: number;
  contractedDays: number;
  requiresReview: boolean;
  explanation: string;
};

type CurrencyProjection = {
  currencyId: string;
  currencyCode: string;
  earnedInMonth: bigint;
  earnedToCutoff: bigint;
  paidInMonth: bigint;
  paidToCutoff: bigint;
  earnedPending: bigint;
  futureCommitted: bigint;
  paidAdvance: bigint;
  costs: ProjectedCost[];
};

const DAY_MS = 86_400_000;

export function buildTrainerServiceCostReport(input: {
  month: unknown;
  currentBusinessDate: Date;
  costs: TrainerServiceCostSnapshot[];
}) {
  const period = parseMonth(input.month);
  const businessDate = calendarDate(input.currentBusinessDate, "El día comercial");
  const currentMonth = businessDate.toISOString().slice(0, 7);
  const future = period.month > currentMonth;
  const businessEndExclusive = addDays(businessDate, 1);
  const cutoffExclusive = future
    ? businessEndExclusive
    : new Date(Math.min(period.endExclusive.getTime(), businessEndExclusive.getTime()));
  const currencies = new Map<string, CurrencyProjection>();
  const grouped = groupRows(input.costs);
  let evaluated = 0;
  let review = 0;
  let withPause = 0;

  for (const rows of grouped.values()) {
    const projected = projectGroup(rows, period.start, cutoffExclusive);
    for (const cost of projected) {
      evaluated += 1;
      if (cost.requiresReview) review += 1;
      if (cost.row.pauses.length > 0) withPause += 1;
      const currency = currencies.get(cost.row.currencyId) ?? {
        currencyId: cost.row.currencyId,
        currencyCode: cost.row.currencyCode,
        earnedInMonth: 0n,
        earnedToCutoff: 0n,
        paidInMonth: 0n,
        paidToCutoff: 0n,
        earnedPending: 0n,
        futureCommitted: 0n,
        paidAdvance: 0n,
        costs: [],
      };
      currency.currencyCode = cost.row.currencyCode;
      currency.earnedInMonth += cost.earnedInMonth;
      currency.earnedToCutoff += cost.earnedToCutoff;
      currency.paidInMonth += cost.paidInMonth;
      currency.paidToCutoff += cost.paidToCutoff;
      currency.earnedPending += cost.earnedPending;
      currency.futureCommitted += cost.futureCommitted;
      currency.paidAdvance += cost.paidAdvance;
      currency.costs.push(cost);
      currencies.set(cost.row.currencyId, currency);
    }
  }

  return {
    mes: period.month,
    naturaleza: "COSTO_DEVENGADO_ENTRENADORES",
    estado_periodo: future
      ? "FUTURO"
      : period.month === currentMonth
      ? "PROVISIONAL"
      : "HISTORICO_RECALCULADO",
    fecha_corte: future
      ? null
      : new Date(cutoffExclusive.getTime() - DAY_MS).toISOString().slice(0, 10),
    cobertura: {
      conceptos_evaluados: evaluated,
      requieren_revision: review,
      conceptos_con_pausa: withPause,
      completa: review === 0,
    },
    monedas: [...currencies.values()]
      .map(presentCurrency)
      .sort((left, right) => left.moneda_codigo.localeCompare(right.moneda_codigo)),
    nota:
      "Separa el costo que el entrenador ya ganó, lo pagado y el compromiso futuro. No representa por sí solo la utilidad del gimnasio.",
    limitaciones: [
      "No mezcla ni convierte monedas.",
      "La compensación fija se muestra por entrenador, pero no se distribuye artificialmente entre planes o socios.",
      "Los meses históricos son reconstrucciones provisionales hasta incorporarse a un cierre certificado.",
    ],
  };
}

function projectGroup(
  sourceRows: TrainerServiceCostSnapshot[],
  monthStart: Date,
  cutoffExclusive: Date,
) {
  const rows = [...sourceRows].sort((left, right) =>
    left.periodStart.getTime() - right.periodStart.getTime() ||
    left.periodEnd.getTime() - right.periodEnd.getTime() ||
    left.costId.localeCompare(right.costId)
  );
  const projected: ProjectedCost[] = [];
  let previousEffectiveEnd: Date | null = null;

  for (const row of rows) {
    try {
      const start = calendarDate(row.periodStart, "El inicio del costo");
      const end = calendarDate(row.periodEnd, "El fin del costo");
      calendarDate(row.scheduledDate, "La fecha programada");
      if (end.getTime() <= start.getTime()) {
        throw new TrainerServiceCostPolicyError(
          `El costo ${row.costId} no tiene un periodo válido.`,
        );
      }
      if (row.createdAt.getTime() >= cutoffExclusive.getTime()) continue;
      if (
        row.state === "ANULADO" &&
        row.updatedAt.getTime() < cutoffExclusive.getTime()
      ) continue;
      const total = money(row.total, "importe del costo");
      if (total <= 0n) {
        throw new TrainerServiceCostPolicyError(
          `El costo ${row.costId} debe tener un importe positivo.`,
        );
      }
      const pauses = activePauses(row.pauses, cutoffExclusive);
      const contractedDays = daysBetween(start, end);
      const effectiveStart = previousEffectiveEnd &&
          previousEffectiveEnd.getTime() > start.getTime()
        ? previousEffectiveEnd
        : start;
      const effectiveEnd = advanceServiceDays(
        effectiveStart,
        contractedDays,
        pauses,
      );
      previousEffectiveEnd = effectiveEnd;
      const earnedAtStart = earnedAt(
        row.earningMethod,
        total,
        effectiveStart,
        effectiveEnd,
        contractedDays,
        pauses,
        monthStart,
      );
      const earnedAtCutoff = earnedAt(
        row.earningMethod,
        total,
        effectiveStart,
        effectiveEnd,
        contractedDays,
        pauses,
        cutoffExclusive,
      );
      const paid = paidProjection(row.applications, monthStart, cutoffExclusive);
      const overpaid = paid.toCutoff > total;
      const paidToCutoff = paid.toCutoff > total ? total : paid.toCutoff;
      const paidToEarned = paidToCutoff > earnedAtCutoff.amount
        ? earnedAtCutoff.amount
        : paidToCutoff;
      const paidAdvance = paidToCutoff - paidToEarned;
      const futureCommitted = total - earnedAtCutoff.amount;
      const noMembership = row.source === "COMISION" && !row.membershipId;
      const unknownMethod = row.earningMethod !== "DIAS_SERVICIO" &&
        row.earningMethod !== "PERIODOS_IGUALES";
      const requiresReview = overpaid || noMembership || unknownMethod ||
        row.normalizedLegacyCalendarDates === true;
      projected.push({
        row,
        total,
        earnedInMonth: earnedAtCutoff.amount - earnedAtStart.amount,
        earnedToCutoff: earnedAtCutoff.amount,
        paidInMonth: paid.inMonth,
        paidToCutoff,
        earnedPending: earnedAtCutoff.amount - paidToEarned,
        futureCommitted,
        paidAdvance,
        serviceDaysInMonth:
          earnedAtCutoff.serviceDays - earnedAtStart.serviceDays,
        serviceDaysToCutoff: earnedAtCutoff.serviceDays,
        contractedDays,
        requiresReview,
        explanation: explanation(row, pauses.length > 0, {
          overpaid,
          noMembership,
          unknownMethod,
        }),
      });
    } catch (error) {
      if (!(error instanceof TrainerServiceCostPolicyError)) throw error;
      projected.push(invalidProjection(row, error.message));
    }
  }
  return projected;
}

function earnedAt(
  method: string,
  total: bigint,
  start: Date,
  end: Date,
  contractedDays: number,
  pauses: Array<{ start: Date; end: Date | null }>,
  cutoff: Date,
) {
  const serviceDays = countServiceDays(start, cutoff, end, pauses);
  if (method === "PERIODOS_IGUALES") {
    return {
      amount: cutoff.getTime() >= end.getTime() ? total : 0n,
      serviceDays,
    };
  }
  if (method !== "DIAS_SERVICIO") {
    return { amount: 0n, serviceDays };
  }
  const base = total / BigInt(contractedDays);
  const remainder = Number(total % BigInt(contractedDays));
  return {
    amount:
      base * BigInt(serviceDays) + BigInt(Math.min(serviceDays, remainder)),
    serviceDays,
  };
}

function paidProjection(
  applications: TrainerServiceCostApplicationSnapshot[],
  monthStart: Date,
  cutoffExclusive: Date,
) {
  let toCutoff = 0n;
  let inMonth = 0n;
  for (const application of applications) {
    if (application.createdAt.getTime() >= cutoffExclusive.getTime()) continue;
    const amount = money(application.amount, "aplicación de pago");
    if (amount <= 0n) {
      throw new TrainerServiceCostPolicyError(
        "Una aplicación de pago debe tener un importe positivo.",
      );
    }
    const reversedBeforeCutoff = application.state === "REVERSADA" &&
      application.updatedAt.getTime() < cutoffExclusive.getTime();
    if (!reversedBeforeCutoff) toCutoff += amount;
    if (
      application.createdAt.getTime() >= monthStart.getTime() &&
      !reversedBeforeCutoff
    ) inMonth += amount;
    if (
      application.state === "REVERSADA" &&
      application.updatedAt.getTime() >= monthStart.getTime() &&
      application.updatedAt.getTime() < cutoffExclusive.getTime() &&
      application.createdAt.getTime() < monthStart.getTime()
    ) inMonth -= amount;
  }
  return { toCutoff, inMonth };
}

function presentCurrency(currency: CurrencyProjection) {
  const trainers = new Map<string, {
    trainerId: string;
    trainerName: string;
    earnedInMonth: bigint;
    earnedToCutoff: bigint;
    paidToCutoff: bigint;
    earnedPending: bigint;
    futureCommitted: bigint;
    concepts: number;
    clients: Set<string>;
    plans: Set<string>;
    requiresReview: boolean;
  }>();
  for (const cost of currency.costs) {
    const trainer = trainers.get(cost.row.trainerId) ?? {
      trainerId: cost.row.trainerId,
      trainerName: cost.row.trainerName,
      earnedInMonth: 0n,
      earnedToCutoff: 0n,
      paidToCutoff: 0n,
      earnedPending: 0n,
      futureCommitted: 0n,
      concepts: 0,
      clients: new Set<string>(),
      plans: new Set<string>(),
      requiresReview: false,
    };
    trainer.earnedInMonth += cost.earnedInMonth;
    trainer.earnedToCutoff += cost.earnedToCutoff;
    trainer.paidToCutoff += cost.paidToCutoff;
    trainer.earnedPending += cost.earnedPending;
    trainer.futureCommitted += cost.futureCommitted;
    trainer.concepts += 1;
    if (cost.row.clientId) trainer.clients.add(cost.row.clientId);
    if (cost.row.planId) trainer.plans.add(cost.row.planId);
    trainer.requiresReview ||= cost.requiresReview;
    trainers.set(cost.row.trainerId, trainer);
  }
  currency.costs.sort((left, right) =>
    left.row.trainerName.localeCompare(right.row.trainerName) ||
    (left.row.clientName ?? "").localeCompare(right.row.clientName ?? "") ||
    left.row.costId.localeCompare(right.row.costId)
  );
  return {
    moneda_id: currency.currencyId,
    moneda_codigo: currency.currencyCode,
    costo_devengado_mes: treasuryMinorToMoney(currency.earnedInMonth),
    costo_devengado_acumulado: treasuryMinorToMoney(currency.earnedToCutoff),
    pagado_mes_neto: treasuryMinorToMoney(currency.paidInMonth),
    pagado_acumulado: treasuryMinorToMoney(currency.paidToCutoff),
    ganado_pendiente_pago: treasuryMinorToMoney(currency.earnedPending),
    costo_futuro_comprometido: treasuryMinorToMoney(currency.futureCommitted),
    pago_anticipado: treasuryMinorToMoney(currency.paidAdvance),
    entrenadores: [...trainers.values()]
      .map((trainer) => ({
        entrenador_id: trainer.trainerId,
        entrenador_nombre: trainer.trainerName,
        costo_devengado_mes: treasuryMinorToMoney(trainer.earnedInMonth),
        costo_devengado_acumulado: treasuryMinorToMoney(trainer.earnedToCutoff),
        pagado_acumulado: treasuryMinorToMoney(trainer.paidToCutoff),
        ganado_pendiente_pago: treasuryMinorToMoney(trainer.earnedPending),
        costo_futuro_comprometido: treasuryMinorToMoney(trainer.futureCommitted),
        conceptos: trainer.concepts,
        clientes: trainer.clients.size,
        planes: trainer.plans.size,
        requiere_revision: trainer.requiresReview,
      }))
      .sort((left, right) =>
        treasuryMoneyToMinor(right.ganado_pendiente_pago) >
            treasuryMoneyToMinor(left.ganado_pendiente_pago)
          ? 1
          : treasuryMoneyToMinor(right.ganado_pendiente_pago) <
              treasuryMoneyToMinor(left.ganado_pendiente_pago)
          ? -1
          : left.entrenador_nombre.localeCompare(right.entrenador_nombre)
      ),
    costos: currency.costs.map((cost) => ({
      costo_id: cost.row.costId,
      grupo_id: cost.row.groupId,
      fuente: cost.row.source,
      entrenador_id: cost.row.trainerId,
      entrenador_nombre: cost.row.trainerName,
      membresia_id: cost.row.membershipId,
      ci: cost.row.clientId,
      cliente_nombre: cost.row.clientName,
      plan_id: cost.row.planId,
      plan_nombre: cost.row.planName,
      metodo_devengo: cost.row.earningMethod,
      estado: cost.row.state,
      periodo_inicio: cost.row.periodStart.toISOString().slice(0, 10),
      periodo_fin: cost.row.periodEnd.toISOString().slice(0, 10),
      fecha_programada: cost.row.scheduledDate.toISOString().slice(0, 10),
      costo_total: treasuryMinorToMoney(cost.total),
      costo_devengado_mes: treasuryMinorToMoney(cost.earnedInMonth),
      costo_devengado_acumulado: treasuryMinorToMoney(cost.earnedToCutoff),
      pagado_mes_neto: treasuryMinorToMoney(cost.paidInMonth),
      pagado_acumulado: treasuryMinorToMoney(cost.paidToCutoff),
      ganado_pendiente_pago: treasuryMinorToMoney(cost.earnedPending),
      costo_futuro_comprometido: treasuryMinorToMoney(cost.futureCommitted),
      pago_anticipado: treasuryMinorToMoney(cost.paidAdvance),
      dias_servicio_mes: cost.serviceDaysInMonth,
      dias_servicio_acumulados: cost.serviceDaysToCutoff,
      dias_contratados: cost.contractedDays,
      atribucion: cost.row.source === "COMISION"
        ? cost.row.membershipId ? "MEMBRESIA" : "SIN_MEMBRESIA"
        : "FIJO_NO_DISTRIBUIDO",
      requiere_revision: cost.requiresReview,
      explicacion: cost.explanation,
    })),
  };
}

function explanation(
  row: TrainerServiceCostSnapshot,
  hasPause: boolean,
  flags: { overpaid: boolean; noMembership: boolean; unknownMethod: boolean },
) {
  const reasons: string[] = [];
  if (row.source === "FIJO") {
    reasons.push("Es compensación fija del entrenador y no se reparte entre socios.");
  } else {
    reasons.push("La comisión conserva el plan, socio y porcentaje congelados al cobrar.");
  }
  if (hasPause) reasons.push("Los días pausados desplazan el calendario de costo.");
  if (flags.overpaid) reasons.push("Las aplicaciones superan el importe del costo.");
  if (flags.noMembership) reasons.push("No existe una membresía verificable para atribuir la comisión.");
  if (flags.unknownMethod) reasons.push("El método de devengo no es reconocido.");
  if (row.normalizedLegacyCalendarDates) {
    reasons.push("Las fechas heredadas se normalizaron al mismo día UTC.");
  }
  return reasons.join(" ");
}

function invalidProjection(
  row: TrainerServiceCostSnapshot,
  reason: string,
): ProjectedCost {
  return {
    row,
    total: 0n,
    earnedInMonth: 0n,
    earnedToCutoff: 0n,
    paidInMonth: 0n,
    paidToCutoff: 0n,
    earnedPending: 0n,
    futureCommitted: 0n,
    paidAdvance: 0n,
    serviceDaysInMonth: 0,
    serviceDaysToCutoff: 0,
    contractedDays: 0,
    requiresReview: true,
    explanation: `No se incluyó en los totales: ${reason}`,
  };
}

function activePauses(
  pauses: TrainerServiceCostPauseSnapshot[],
  cutoffExclusive: Date,
) {
  return pauses
    .filter((pause) =>
      pause.createdAt.getTime() < cutoffExclusive.getTime() &&
      (pause.deletedAt == null || pause.deletedAt.getTime() >= cutoffExclusive.getTime())
    )
    .map((pause) => ({
      start: calendarDate(pause.start, "El inicio de pausa"),
      end: pause.end ? calendarDate(pause.end, "El fin de pausa") : null,
    }));
}

function advanceServiceDays(
  start: Date,
  targetDays: number,
  pauses: Array<{ start: Date; end: Date | null }>,
) {
  let completed = 0;
  let day = new Date(start.getTime());
  const safetyLimit = targetDays + 36_600;
  let iterations = 0;
  while (completed < targetDays) {
    const activePause = pauses.find((pause) =>
      day.getTime() >= pause.start.getTime() &&
      (pause.end == null || day.getTime() < pause.end.getTime())
    );
    if (activePause && activePause.end == null) {
      return new Date(Date.UTC(9999, 0, 1));
    }
    if (!activePause) completed += 1;
    day = addDays(day, 1);
    iterations += 1;
    if (iterations > safetyLimit) {
      throw new TrainerServiceCostPolicyError(
        "Una pausa abierta impide proyectar el final del costo.",
      );
    }
  }
  return day;
}

function countServiceDays(
  start: Date,
  cutoff: Date,
  end: Date,
  pauses: Array<{ start: Date; end: Date | null }>,
) {
  let count = 0;
  const limit = Math.min(cutoff.getTime(), end.getTime());
  for (let day = start; day.getTime() < limit; day = addDays(day, 1)) {
    if (!paused(day, pauses)) count += 1;
  }
  return count;
}

function paused(day: Date, pauses: Array<{ start: Date; end: Date | null }>) {
  return pauses.some((pause) =>
    day.getTime() >= pause.start.getTime() &&
    (pause.end == null || day.getTime() < pause.end.getTime())
  );
}

function groupRows(rows: TrainerServiceCostSnapshot[]) {
  const groups = new Map<string, TrainerServiceCostSnapshot[]>();
  for (const row of rows) {
    const values = groups.get(row.groupId) ?? [];
    values.push(row);
    groups.set(row.groupId, values);
  }
  return groups;
}

function parseMonth(value: unknown) {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new TrainerServiceCostPolicyError("El mes debe usar el formato AAAA-MM.");
  }
  const start = new Date(`${month}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 7) !== month) {
    throw new TrainerServiceCostPolicyError("El mes no es válido.");
  }
  return {
    month,
    start,
    endExclusive: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
  };
}

function calendarDate(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TrainerServiceCostPolicyError(`${label} no es válido.`);
  }
  if (
    value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0 ||
    value.getUTCSeconds() !== 0 || value.getUTCMilliseconds() !== 0
  ) {
    throw new TrainerServiceCostPolicyError(`${label} debe ser un día UTC canónico.`);
  }
  return new Date(value.getTime());
}

function daysBetween(start: Date, end: Date) {
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (days <= 0) {
    throw new TrainerServiceCostPolicyError("El periodo debe contener al menos un día.");
  }
  return days;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

function money(value: string, label: string) {
  try {
    return treasuryMoneyToMinor(value);
  } catch {
    throw new TrainerServiceCostPolicyError(`${label} no contiene un decimal válido.`);
  }
}

