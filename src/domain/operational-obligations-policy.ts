const DAY_MS = 86_400_000;

export type ObligationApplicationSnapshot = {
  amountMinor: bigint;
  state: "APLICADA" | "REVERSADA";
  createdAt: Date;
  updatedAt: Date;
};

export type TrainerObligationSnapshot = {
  totalMinor: bigint;
  earningMethod: string;
  periodStart: Date;
  periodEnd: Date;
  scheduledDate: Date;
  state: string;
  createdAt: Date;
  updatedAt: Date;
  applications: ObligationApplicationSnapshot[];
};

export type RefundDecisionEvent = {
  type: "RESUELTO" | "REABIERTO";
  occurredAt: Date;
};

export class OperationalObligationsPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationalObligationsPolicyError";
  }
}

export function classifyTrainerObligationAtCutoff(
  row: TrainerObligationSnapshot,
  cutoffExclusive: Date,
) {
  assertValidInstant(cutoffExclusive, "La fecha de corte");
  assertValidInstant(row.createdAt, "La fecha de creación");
  assertValidInstant(row.updatedAt, "La fecha de actualización");
  assertCalendarPeriod(row.periodStart, row.periodEnd);
  if (row.totalMinor <= 0n) {
    throw new OperationalObligationsPolicyError(
      "La obligación debe tener un importe positivo.",
    );
  }

  const existed = row.createdAt.getTime() < cutoffExclusive.getTime()
    && !(row.state === "ANULADO" && row.updatedAt.getTime() < cutoffExclusive.getTime());
  if (!existed) return emptyProjection(false);

  const appliedRaw = row.applications.reduce((sum, application) => {
    if (application.amountMinor <= 0n) {
      throw new OperationalObligationsPolicyError(
        "Una aplicación debe tener un importe positivo.",
      );
    }
    if (!applicationWasActiveAtCutoff(application, cutoffExclusive)) return sum;
    return sum + application.amountMinor;
  }, 0n);
  const overApplied = appliedRaw > row.totalMinor;
  const appliedMinor = appliedRaw > row.totalMinor ? row.totalMinor : appliedRaw;
  const earnedMinor = earnedAtCutoff(row, cutoffExclusive);
  const futureMinor = row.totalMinor - earnedMinor;
  const appliedToEarned = appliedMinor > earnedMinor ? earnedMinor : appliedMinor;
  const remainingApplied = appliedMinor - appliedToEarned;
  const appliedToFuture = remainingApplied > futureMinor ? futureMinor : remainingApplied;
  const earnedPendingMinor = earnedMinor - appliedToEarned;
  const futurePendingMinor = futureMinor - appliedToFuture;
  const payableNowMinor = row.scheduledDate.getTime() < cutoffExclusive.getTime()
    ? earnedPendingMinor
    : 0n;

  return {
    existed: true,
    totalMinor: row.totalMinor,
    appliedMinor,
    earnedMinor,
    earnedPendingMinor,
    futurePendingMinor,
    payableNowMinor,
    overdue: payableNowMinor > 0n,
    requiresReview: overApplied,
  };
}

export function refundWasPendingAtCutoff(input: {
  requestedAt: Date;
  events: RefundDecisionEvent[];
}, cutoffExclusive: Date) {
  assertValidInstant(input.requestedAt, "La fecha de solicitud");
  assertValidInstant(cutoffExclusive, "La fecha de corte");
  if (input.requestedAt.getTime() >= cutoffExclusive.getTime()) return false;
  let pending = true;
  for (const event of [...input.events].sort(
    (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
  )) {
    assertValidInstant(event.occurredAt, "La fecha del evento de reembolso");
    if (event.occurredAt.getTime() >= cutoffExclusive.getTime()) break;
    pending = event.type === "REABIERTO";
  }
  return pending;
}

function applicationWasActiveAtCutoff(
  application: ObligationApplicationSnapshot,
  cutoffExclusive: Date,
) {
  assertValidInstant(application.createdAt, "La fecha de aplicación");
  assertValidInstant(application.updatedAt, "La fecha de actualización de aplicación");
  if (application.createdAt.getTime() >= cutoffExclusive.getTime()) return false;
  if (application.state === "APLICADA") return true;
  if (application.state === "REVERSADA") {
    return application.updatedAt.getTime() >= cutoffExclusive.getTime();
  }
  throw new OperationalObligationsPolicyError(
    `Estado de aplicación desconocido: ${application.state}.`,
  );
}

function earnedAtCutoff(
  row: TrainerObligationSnapshot,
  cutoffExclusive: Date,
) {
  const cutoff = cutoffExclusive.getTime();
  const start = row.periodStart.getTime();
  const end = row.periodEnd.getTime();
  if (cutoff <= start) return 0n;
  if (cutoff >= end) return row.totalMinor;
  if (row.earningMethod !== "DIAS_SERVICIO") return 0n;

  const totalDays = Math.round((end - start) / DAY_MS);
  const elapsedDays = Math.max(
    0,
    Math.min(totalDays, Math.round((cutoff - start) / DAY_MS)),
  );
  const base = row.totalMinor / BigInt(totalDays);
  const remainder = Number(row.totalMinor % BigInt(totalDays));
  return base * BigInt(elapsedDays) + BigInt(Math.min(elapsedDays, remainder));
}

function emptyProjection(existed: boolean) {
  return {
    existed,
    totalMinor: 0n,
    appliedMinor: 0n,
    earnedMinor: 0n,
    earnedPendingMinor: 0n,
    futurePendingMinor: 0n,
    payableNowMinor: 0n,
    overdue: false,
    requiresReview: false,
  };
}

function assertCalendarPeriod(start: Date, end: Date) {
  assertValidInstant(start, "El inicio del periodo");
  assertValidInstant(end, "El fin del periodo");
  if (end.getTime() <= start.getTime()) {
    throw new OperationalObligationsPolicyError(
      "El periodo de la obligación debe ser positivo.",
    );
  }
  if (
    start.getUTCHours() !== 0 || start.getUTCMinutes() !== 0 ||
    start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0 ||
    end.getUTCHours() !== 0 || end.getUTCMinutes() !== 0 ||
    end.getUTCSeconds() !== 0 || end.getUTCMilliseconds() !== 0
  ) {
    throw new OperationalObligationsPolicyError(
      "Los periodos de obligaciones deben usar días UTC canónicos.",
    );
  }
}

function assertValidInstant(value: Date, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new OperationalObligationsPolicyError(`${label} no es válida.`);
  }
}
