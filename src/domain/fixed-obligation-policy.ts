import {
  calendarDateUtc,
  type CommissionEarningMethod,
  type PayoutFrequency,
} from "./compensation-profile-policy";

const DAY_MS = 86_400_000;
const MAX_DAYS = 20 * 366;

export interface FixedObligationPeriod {
  periodStart: Date;
  periodEnd: Date;
  payableDate: Date;
  amount: string;
  coveredDays: number;
  cycleDays: number;
  earningMethod: CommissionEarningMethod;
}

export class FixedObligationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixedObligationPolicyError";
  }
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function dayDiff(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function moneyToMinor(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new FixedObligationPolicyError(
      "El importe fijo debe tener como máximo dos decimales.",
    );
  }
  const [whole, fraction = ""] = normalized.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor <= 0n) {
    throw new FixedObligationPolicyError("El importe fijo debe ser mayor que cero.");
  }
  return minor;
}

function minorToMoney(value: bigint) {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

function nextMonthlyCutoff(onOrAfter: Date, cutoff: number) {
  const candidate = new Date(Date.UTC(
    onOrAfter.getUTCFullYear(),
    onOrAfter.getUTCMonth(),
    cutoff,
  ));
  if (candidate.getTime() >= onOrAfter.getTime()) return candidate;
  const nextMonth = new Date(Date.UTC(
    onOrAfter.getUTCFullYear(),
    onOrAfter.getUTCMonth() + 1,
    1,
  ));
  return new Date(Date.UTC(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth(),
    cutoff,
  ));
}

function quincenalCutoffs(year: number, month: number, first: number) {
  return [first, Math.min(first + 15, daysInMonth(year, month))]
    .map((day) => new Date(Date.UTC(year, month, day)));
}

function nextCycleEnd(
  onOrAfter: Date,
  frequency: PayoutFrequency,
  cutoff: number | null,
) {
  if (frequency === "DIARIA") return onOrAfter;
  if (frequency === "SEMANAL") {
    const isoDay = onOrAfter.getUTCDay() === 0 ? 7 : onOrAfter.getUTCDay();
    return addDays(onOrAfter, ((cutoff ?? 7) - isoDay + 7) % 7);
  }
  if (frequency === "MENSUAL") {
    return nextMonthlyCutoff(onOrAfter, cutoff ?? 28);
  }
  if (frequency === "QUINCENAL") {
    const first = cutoff ?? 15;
    const current = quincenalCutoffs(
      onOrAfter.getUTCFullYear(),
      onOrAfter.getUTCMonth(),
      first,
    ).find((candidate) => candidate.getTime() >= onOrAfter.getTime());
    if (current) return current;
    const nextMonth = new Date(Date.UTC(
      onOrAfter.getUTCFullYear(),
      onOrAfter.getUTCMonth() + 1,
      1,
    ));
    return new Date(Date.UTC(
      nextMonth.getUTCFullYear(),
      nextMonth.getUTCMonth(),
      first,
    ));
  }
  throw new FixedObligationPolicyError(
    "La frecuencia extraordinaria no genera obligaciones automáticas.",
  );
}

function previousCycleEnd(
  cycleEnd: Date,
  frequency: PayoutFrequency,
  cutoff: number | null,
) {
  if (frequency === "DIARIA") return addDays(cycleEnd, -1);
  if (frequency === "SEMANAL") return addDays(cycleEnd, -7);
  if (frequency === "MENSUAL") {
    return new Date(Date.UTC(
      cycleEnd.getUTCFullYear(),
      cycleEnd.getUTCMonth() - 1,
      cutoff ?? 28,
    ));
  }
  const first = cutoff ?? 15;
  if (cycleEnd.getUTCDate() === first) {
    const previousMonth = new Date(Date.UTC(
      cycleEnd.getUTCFullYear(),
      cycleEnd.getUTCMonth() - 1,
      1,
    ));
    return quincenalCutoffs(
      previousMonth.getUTCFullYear(),
      previousMonth.getUTCMonth(),
      first,
    )[1];
  }
  return new Date(Date.UTC(
    cycleEnd.getUTCFullYear(),
    cycleEnd.getUTCMonth(),
    first,
  ));
}

export function buildFixedObligationSchedule(input: {
  fixedAmount: string;
  profileStart: Date;
  profileEnd: Date | null;
  throughDate: Date;
  earningMethod: CommissionEarningMethod;
  payoutFrequency: PayoutFrequency;
  cutoffDay: number | null;
}): FixedObligationPeriod[] {
  if (input.payoutFrequency === "EXTRAORDINARIA") return [];
  const start = calendarDateUtc(input.profileStart, "El inicio del perfil");
  const through = calendarDateUtc(input.throughDate, "El día de materialización");
  const profileEnd = input.profileEnd
    ? calendarDateUtc(input.profileEnd, "El fin del perfil")
    : null;
  const accrualEnd = profileEnd && profileEnd.getTime() < through.getTime()
    ? profileEnd
    : through;
  const totalDays = dayDiff(start, accrualEnd);
  if (totalDays <= 0) return [];
  if (totalDays > MAX_DAYS) {
    throw new FixedObligationPolicyError(
      "El perfil supera veinte años; divida la vigencia antes de materializar.",
    );
  }

  const groups = new Map<string, {
    start: Date;
    end: Date;
    cycleStart: Date;
    cycleEnd: Date;
    payableDate: Date;
  }>();
  for (let index = 0; index < totalDays; index += 1) {
    const dayStart = addDays(start, index);
    const dayEnd = addDays(dayStart, 1);
    const cycleEnd = nextCycleEnd(dayEnd, input.payoutFrequency, input.cutoffDay);
    const terminatedInsideCycle = profileEnd
      && profileEnd.getTime() <= through.getTime()
      && profileEnd.getTime() < cycleEnd.getTime();
    const payableDate = terminatedInsideCycle ? profileEnd : cycleEnd;
    if (payableDate.getTime() > through.getTime()) continue;
    const key = cycleEnd.toISOString();
    const current = groups.get(key);
    if (current) {
      current.end = dayEnd;
    } else {
      groups.set(key, {
        start: dayStart,
        end: dayEnd,
        cycleStart: previousCycleEnd(cycleEnd, input.payoutFrequency, input.cutoffDay),
        cycleEnd,
        payableDate,
      });
    }
  }

  const fixedMinor = moneyToMinor(input.fixedAmount);
  return [...groups.values()].map((group) => {
    const coveredDays = dayDiff(group.start, group.end);
    const cycleDays = dayDiff(group.cycleStart, group.cycleEnd);
    const amountMinor = input.earningMethod === "DIAS_SERVICIO"
      ? (fixedMinor * BigInt(coveredDays) + BigInt(Math.floor(cycleDays / 2)))
          / BigInt(cycleDays)
      : fixedMinor;
    return {
      periodStart: group.start,
      periodEnd: group.end,
      payableDate: group.payableDate,
      amount: minorToMoney(amountMinor),
      coveredDays,
      cycleDays,
      earningMethod: input.earningMethod,
    };
  });
}
