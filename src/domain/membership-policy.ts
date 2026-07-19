export interface ServicePeriodInput {
  plannedStart: Date;
  activeMembershipEnd?: Date | null;
  businessToday: Date;
  durationDays: number;
}

export interface ServicePeriod {
  start: Date;
  endExclusive: Date;
}

export interface MembershipPauseSnapshot {
  effectiveDate: Date;
  previousEndExclusive: Date;
  remainingDays: number;
}

export interface MembershipResumeResult {
  effectiveDate: Date;
  newEndExclusive: Date;
  pausedCalendarDays: number;
}

export function calendarDateUtc(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

export function addCalendarDays(value: Date, days: number): Date {
  const date = calendarDateUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function calendarDayDifference(start: Date, endExclusive: Date): number {
  return Math.trunc(
    (calendarDateUtc(endExclusive).getTime() - calendarDateUtc(start).getTime()) /
      86_400_000,
  );
}

export function resolveMembershipPause(input: {
  membershipStart: Date;
  membershipEndExclusive: Date;
  effectiveDate: Date;
}): MembershipPauseSnapshot {
  const start = calendarDateUtc(input.membershipStart);
  const end = calendarDateUtc(input.membershipEndExclusive);
  const effective = calendarDateUtc(input.effectiveDate);
  if (effective.getTime() < start.getTime()) {
    throw new Error("La pausa no puede comenzar antes de la membresía.");
  }
  if (effective.getTime() >= end.getTime()) {
    throw new Error("La membresía ya no tiene días disponibles para pausar.");
  }
  const remainingDays = calendarDayDifference(effective, end);
  if (remainingDays <= 0) {
    throw new Error("La membresía no tiene días disponibles para pausar.");
  }
  return {
    effectiveDate: effective,
    previousEndExclusive: end,
    remainingDays,
  };
}

export function resolveMembershipResume(input: {
  pauseEffectiveDate: Date;
  resumeEffectiveDate: Date;
  remainingDays: number;
}): MembershipResumeResult {
  if (!Number.isInteger(input.remainingDays) || input.remainingDays <= 0) {
    throw new Error("Los días restantes de la pausa no son válidos.");
  }
  const paused = calendarDateUtc(input.pauseEffectiveDate);
  const resumed = calendarDateUtc(input.resumeEffectiveDate);
  if (resumed.getTime() < paused.getTime()) {
    throw new Error("La reanudación no puede ser anterior a la pausa.");
  }
  return {
    effectiveDate: resumed,
    newEndExclusive: addCalendarDays(resumed, input.remainingDays),
    pausedCalendarDays: calendarDayDifference(paused, resumed),
  };
}

export function resolveServicePeriod(input: ServicePeriodInput): ServicePeriod {
  if (!Number.isInteger(input.durationDays) || input.durationDays <= 0) {
    throw new Error("La duración del plan debe ser mayor que cero.");
  }

  const planned = calendarDateUtc(input.plannedStart);
  const today = calendarDateUtc(input.businessToday);
  const activeEnd = input.activeMembershipEnd
    ? calendarDateUtc(input.activeMembershipEnd)
    : null;

  let start = planned.getTime() > today.getTime() ? planned : today;
  if (activeEnd && activeEnd.getTime() > start.getTime()) start = activeEnd;

  return {
    start,
    endExclusive: addCalendarDays(start, input.durationDays),
  };
}

export function isFullPayment(
  paid: number,
  contracted: number,
  tolerance = 0.01,
): boolean {
  if (!Number.isFinite(paid) || !Number.isFinite(contracted)) return false;
  return paid + tolerance >= contracted;
}

export function membershipCashRequired(contracted: number, alreadyApplied: number) {
  if (!Number.isFinite(contracted) || contracted < 0 ||
      !Number.isFinite(alreadyApplied) || alreadyApplied < 0) {
    throw new Error("Los importes de la membresía no son válidos.");
  }
  return Math.max(0, Math.round((contracted - alreadyApplied) * 100) / 100);
}
