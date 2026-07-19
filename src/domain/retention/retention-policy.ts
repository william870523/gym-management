export const RETENTION_ELIGIBLE_MEMBERSHIP_STATES = ["ACTIVA", "VENCIDA"] as const;

export type RetentionState =
  | "PROXIMO"
  | "VENCE_HOY"
  | "EN_GRACIA"
  | "RENOVADO_PUNTUAL"
  | "RENOVADO_EN_GRACIA"
  | "SALIDA"
  | "RECUPERADO";

export type RenewalEvidence = "ACTIVADA_AT" | "FECHA_INICIO_RECONSTRUIDA";

export interface RetentionPolicyInput {
  membershipState: string;
  dueDate: Date;
  businessToday: Date;
  graceDays: number;
  horizonDays: number;
  renewalEffectiveDate?: Date | null;
  renewalEvidence?: RenewalEvidence | null;
}

export interface RetentionClassification {
  state: RetentionState;
  dueDate: Date;
  graceEndDate: Date;
  exitDate: Date;
  daysFromDue: number;
  renewalDelayDays: number | null;
  historicalExit: boolean;
  renewalEvidence: RenewalEvidence | null;
  reason: string;
}

const DAY_MS = 86_400_000;

function assertCalendarDate(value: Date, name: string): void {
  if (Number.isNaN(value.getTime())) throw new Error(`${name} no es una fecha valida`);
  if (
    value.getUTCHours() !== 0 ||
    value.getUTCMinutes() !== 0 ||
    value.getUTCSeconds() !== 0 ||
    value.getUTCMilliseconds() !== 0
  ) {
    throw new Error(`${name} debe ser un dia de calendario UTC (00:00Z)`);
  }
}

export function calendarDayDiff(from: Date, to: Date): number {
  assertCalendarDate(from, "from");
  assertCalendarDate(to, "to");
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function addCalendarDays(date: Date, days: number): Date {
  assertCalendarDate(date, "date");
  return new Date(date.getTime() + days * DAY_MS);
}

export function retentionMatureCutoff(
  businessToday: Date,
  graceDays: number,
): Date {
  if (!Number.isInteger(graceDays) || graceDays < 0) {
    throw new Error("graceDays debe ser un entero mayor o igual que cero");
  }
  assertCalendarDate(businessToday, "businessToday");
  return addCalendarDays(businessToday, -(graceDays + 1));
}

export function classifyRetention(
  input: RetentionPolicyInput,
): RetentionClassification | null {
  if (!(RETENTION_ELIGIBLE_MEMBERSHIP_STATES as readonly string[]).includes(input.membershipState)) return null;
  if (!Number.isInteger(input.graceDays) || input.graceDays < 0) {
    throw new Error("graceDays debe ser un entero mayor o igual que cero");
  }
  if (!Number.isInteger(input.horizonDays) || input.horizonDays < 1) {
    throw new Error("horizonDays debe ser un entero mayor o igual que uno");
  }

  assertCalendarDate(input.dueDate, "dueDate");
  assertCalendarDate(input.businessToday, "businessToday");
  const daysFromDue = calendarDayDiff(input.dueDate, input.businessToday);
  const graceEndDate = addCalendarDays(input.dueDate, input.graceDays);
  const exitDate = addCalendarDays(graceEndDate, 1);

  if (input.renewalEffectiveDate) {
    assertCalendarDate(input.renewalEffectiveDate, "renewalEffectiveDate");
    const renewalDelayDays = calendarDayDiff(input.dueDate, input.renewalEffectiveDate);
    const historicalExit = renewalDelayDays > input.graceDays;
    const state: RetentionState = renewalDelayDays <= 0
      ? "RENOVADO_PUNTUAL"
      : historicalExit
        ? "RECUPERADO"
        : "RENOVADO_EN_GRACIA";
    const reason = state === "RENOVADO_PUNTUAL"
      ? "Renovo antes o en la fecha esperada."
      : state === "RENOVADO_EN_GRACIA"
        ? `Renovo ${renewalDelayDays} dia(s) despues, dentro de la gracia de ${input.graceDays} dia(s).`
        : `Regreso ${renewalDelayDays} dia(s) despues; ya habia causado salida el ${formatDateOnly(exitDate)}.`;
    return {
      state,
      dueDate: input.dueDate,
      graceEndDate,
      exitDate,
      daysFromDue,
      renewalDelayDays,
      historicalExit,
      renewalEvidence: input.renewalEvidence ?? null,
      reason,
    };
  }

  if (daysFromDue < -input.horizonDays) return null;

  let state: RetentionState;
  let reason: string;
  if (daysFromDue < 0) {
    state = "PROXIMO";
    reason = `Debe renovar en ${Math.abs(daysFromDue)} dia(s).`;
  } else if (daysFromDue === 0) {
    state = "VENCE_HOY";
    reason = "La renovacion corresponde al dia de hoy.";
  } else if (daysFromDue <= input.graceDays) {
    state = "EN_GRACIA";
    reason = `Lleva ${daysFromDue} dia(s) de atraso y aun esta dentro de la gracia.`;
  } else {
    state = "SALIDA";
    reason = `No renovo durante la gracia; causa salida desde el ${formatDateOnly(exitDate)}.`;
  }
  return {
    state,
    dueDate: input.dueDate,
    graceEndDate,
    exitDate,
    daysFromDue,
    renewalDelayDays: null,
    historicalExit: state === "SALIDA",
    renewalEvidence: null,
    reason,
  };
}

export function formatDateOnly(date: Date): string {
  assertCalendarDate(date, "date");
  return date.toISOString().slice(0, 10);
}
