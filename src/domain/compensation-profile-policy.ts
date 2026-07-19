export const COMPENSATION_MODALITIES = ["COMISION", "FIJO", "MIXTO"] as const;
export const COMMISSION_EARNING_METHODS = [
  "PERIODOS_IGUALES",
  "DIAS_SERVICIO",
] as const;
export const PAYOUT_FREQUENCIES = [
  "DIARIA",
  "SEMANAL",
  "QUINCENAL",
  "MENSUAL",
  "EXTRAORDINARIA",
] as const;

export type CompensationModality = (typeof COMPENSATION_MODALITIES)[number];
export type CommissionEarningMethod = (typeof COMMISSION_EARNING_METHODS)[number];
export type PayoutFrequency = (typeof PAYOUT_FREQUENCIES)[number];
export type CompensationProfileStatus =
  | "VIGENTE"
  | "PROGRAMADO"
  | "FINALIZADO"
  | "INACTIVO";

export interface CompensationProfileDraft {
  trainerId: string;
  modality: CompensationModality;
  earningMethod: CommissionEarningMethod;
  payoutFrequency: PayoutFrequency;
  cutoffDay: number | null;
  fixedAmount: string | null;
  currencyId: string | null;
  preferredAccountId: string | null;
  startDate: Date;
  endDate: Date | null;
  notes: string | null;
  active: boolean;
}

export interface CompensationProfileInterval {
  trainerId: string;
  startDate: Date;
  endDate: Date | null;
  active?: boolean;
  deleted?: boolean;
}

export interface CommissionScheduleItem {
  periodStart: Date;
  periodEnd: Date;
  payableDate: Date;
  amount: string;
}

export class CompensationProfilePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompensationProfilePolicyError";
  }
}

const DAY_MS = 86_400_000;

function required(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new CompensationProfilePolicyError(`${label} es requerido.`);
  return normalized;
}

function optional(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function calendarDateUtc(value: unknown, label: string): Date {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime())) {
    throw new CompensationProfilePolicyError(`${label} no es una fecha válida.`);
  }
  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  ));
}

function money(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new CompensationProfilePolicyError(`${label} debe tener como máximo dos decimales.`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor <= 0n) {
    throw new CompensationProfilePolicyError(`${label} debe ser mayor que cero.`);
  }
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}

function cutoffDay(frequency: PayoutFrequency, value: unknown): number | null {
  if (frequency === "DIARIA" || frequency === "EXTRAORDINARIA") return null;
  const parsed = Number(value);
  const maximum = frequency === "SEMANAL" ? 7 : frequency === "QUINCENAL" ? 15 : 28;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    const meaning = frequency === "SEMANAL"
      ? "un día ISO de la semana entre 1 y 7"
      : frequency === "QUINCENAL"
        ? "un primer corte del mes entre 1 y 15"
        : "un día del mes entre 1 y 28";
    throw new CompensationProfilePolicyError(`El día de corte debe ser ${meaning}.`);
  }
  return parsed;
}

export function normalizeCompensationProfileDraft(
  input: Record<string, unknown>,
  defaultStartDate: Date,
): CompensationProfileDraft {
  const trainerId = required(input.id_entrenador, "El entrenador");
  const modality = String(input.modalidad ?? "").trim().toUpperCase() as CompensationModality;
  if (!COMPENSATION_MODALITIES.includes(modality)) {
    throw new CompensationProfilePolicyError("La modalidad debe ser comisión, fijo o mixto.");
  }
  const earningMethod = String(input.metodo_devengo ?? "PERIODOS_IGUALES")
    .trim()
    .toUpperCase() as CommissionEarningMethod;
  if (!COMMISSION_EARNING_METHODS.includes(earningMethod)) {
    throw new CompensationProfilePolicyError(
      "El devengo debe calcularse por periodos iguales o días de servicio.",
    );
  }
  const payoutFrequency = String(input.frecuencia_desembolso ?? "")
    .trim()
    .toUpperCase() as PayoutFrequency;
  if (!PAYOUT_FREQUENCIES.includes(payoutFrequency)) {
    throw new CompensationProfilePolicyError("Seleccione una frecuencia de desembolso válida.");
  }

  const fixed = modality === "COMISION"
    ? null
    : money(input.monto_fijo, "El importe fijo");
  const currencyId = modality === "COMISION"
    ? null
    : required(input.moneda_id, "La moneda del importe fijo");
  const startDate = calendarDateUtc(
    input.fecha_inicio ?? defaultStartDate,
    "La fecha de inicio",
  );
  const endDate = input.fecha_fin === undefined || input.fecha_fin === null || input.fecha_fin === ""
    ? null
    : calendarDateUtc(input.fecha_fin, "La fecha de fin");
  if (endDate && endDate.getTime() <= startDate.getTime()) {
    throw new CompensationProfilePolicyError(
      "La fecha de fin debe ser posterior a la fecha de inicio.",
    );
  }

  return {
    trainerId,
    modality,
    earningMethod,
    payoutFrequency,
    cutoffDay: cutoffDay(payoutFrequency, input.dia_corte),
    fixedAmount: fixed,
    currencyId,
    preferredAccountId: optional(input.cuenta_preferida_id),
    startDate,
    endDate,
    notes: optional(input.notas),
    active: input.activo !== false,
  };
}

export function compensationProfilesOverlap(
  left: CompensationProfileInterval,
  right: CompensationProfileInterval,
): boolean {
  if (left.trainerId !== right.trainerId) return false;
  if (left.active === false || right.active === false) return false;
  if (left.deleted === true || right.deleted === true) return false;
  const leftEnd = left.endDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.endDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return left.startDate.getTime() < rightEnd && right.startDate.getTime() < leftEnd;
}

export function compensationProfileStatusAt(
  profile: CompensationProfileInterval,
  businessToday: Date,
): CompensationProfileStatus {
  if (profile.active === false || profile.deleted === true) return "INACTIVO";
  const today = calendarDateUtc(businessToday, "El día comercial").getTime();
  if (profile.startDate.getTime() > today) return "PROGRAMADO";
  if (profile.endDate && profile.endDate.getTime() <= today) return "FINALIZADO";
  return "VIGENTE";
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addMonthsClamped(date: Date, months: number): Date {
  const targetMonth = date.getUTCMonth() + months;
  const year = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const month = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

function nextPayoutDate(
  onOrAfter: Date,
  frequency: PayoutFrequency,
  cutoff: number | null,
  extraordinaryEnd: Date,
): Date {
  if (frequency === "DIARIA") return onOrAfter;
  if (frequency === "EXTRAORDINARIA") return extraordinaryEnd;
  if (frequency === "SEMANAL") {
    const isoDay = onOrAfter.getUTCDay() === 0 ? 7 : onOrAfter.getUTCDay();
    return addDays(onOrAfter, ((cutoff ?? 7) - isoDay + 7) % 7);
  }

  const year = onOrAfter.getUTCFullYear();
  const month = onOrAfter.getUTCMonth();
  if (frequency === "MENSUAL") {
    const candidate = new Date(Date.UTC(year, month, cutoff ?? 28));
    return candidate.getTime() >= onOrAfter.getTime()
      ? candidate
      : new Date(Date.UTC(
          addMonthsClamped(candidate, 1).getUTCFullYear(),
          addMonthsClamped(candidate, 1).getUTCMonth(),
          cutoff ?? 28,
        ));
  }

  const first = cutoff ?? 15;
  const last = daysInMonth(year, month);
  const candidates = [first, Math.min(first + 15, last)]
    .map((day) => new Date(Date.UTC(year, month, day)));
  const current = candidates.find((candidate) => candidate.getTime() >= onOrAfter.getTime());
  if (current) return current;
  const next = addMonthsClamped(new Date(Date.UTC(year, month, first)), 1);
  return new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), first));
}

function minorToMoney(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

function moneyToMinor(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

export function buildCommissionSchedule(input: {
  totalAmount: string;
  serviceStart: Date;
  serviceEnd: Date;
  earningMethod: CommissionEarningMethod;
  payoutFrequency: PayoutFrequency;
  cutoffDay: number | null;
}): CommissionScheduleItem[] {
  const start = calendarDateUtc(input.serviceStart, "El inicio del servicio");
  const end = calendarDateUtc(input.serviceEnd, "El fin del servicio");
  const totalDays = daysBetween(start, end);
  if (totalDays <= 0) {
    throw new CompensationProfilePolicyError("El periodo de servicio debe contener al menos un día.");
  }
  const totalMinor = moneyToMinor(money(input.totalAmount, "La comisión total"));

  if (input.earningMethod === "PERIODOS_IGUALES") {
    const count = totalDays >= 360 ? 12 : totalDays <= 31 ? 1 : Math.ceil(totalDays / 30);
    const base = totalMinor / BigInt(count);
    const remainder = totalMinor % BigInt(count);
    return Array.from({ length: count }, (_, index) => {
      const periodStart = addMonthsClamped(start, index);
      const periodEnd = index === count - 1
        ? end
        : [addMonthsClamped(start, index + 1), end]
            .sort((a, b) => a.getTime() - b.getTime())[0];
      const amount = base + (BigInt(index) < remainder ? 1n : 0n);
      return {
        periodStart,
        periodEnd,
        payableDate: nextPayoutDate(
          periodEnd,
          input.payoutFrequency,
          input.cutoffDay,
          end,
        ),
        amount: minorToMoney(amount),
      };
    });
  }

  const basePerDay = totalMinor / BigInt(totalDays);
  const remainderDays = Number(totalMinor % BigInt(totalDays));
  const groups: Array<{
    periodStart: Date;
    periodEnd: Date;
    payableDate: Date;
    minor: bigint;
  }> = [];
  for (let index = 0; index < totalDays; index += 1) {
    const periodStart = addDays(start, index);
    const periodEnd = addDays(periodStart, 1);
    const payableDate = nextPayoutDate(
      periodEnd,
      input.payoutFrequency,
      input.cutoffDay,
      end,
    );
    const minor = basePerDay + (index < remainderDays ? 1n : 0n);
    const previous = groups[groups.length - 1];
    if (previous && previous.payableDate.getTime() === payableDate.getTime()) {
      previous.periodEnd = periodEnd;
      previous.minor += minor;
    } else {
      groups.push({ periodStart, periodEnd, payableDate, minor });
    }
  }
  return groups.map((item) => ({
    periodStart: item.periodStart,
    periodEnd: item.periodEnd,
    payableDate: item.payableDate,
    amount: minorToMoney(item.minor),
  }));
}

