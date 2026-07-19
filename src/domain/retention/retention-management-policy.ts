import { calendarDayDiff } from "./retention-policy";

export const RETENTION_MANAGEMENT_RESULTS = [
  "CONTACTADO",
  "PROMESA_PAGO",
  "NO_LOCALIZADO",
  "NO_DESEA_RENOVAR",
] as const;

export const RETENTION_MANAGEMENT_CHANNELS = [
  "LLAMADA",
  "WHATSAPP",
  "SMS",
  "PRESENCIAL",
  "OTRO",
] as const;

export type RetentionManagementResult = typeof RETENTION_MANAGEMENT_RESULTS[number];
export type RetentionManagementChannel = typeof RETENTION_MANAGEMENT_CHANNELS[number];

export interface RetentionManagementPolicyInput {
  result: string;
  channel: string;
  note?: string | null;
  promiseDate?: Date | null;
  nextManagementDate?: Date | null;
  businessToday: Date;
}

export interface NormalizedRetentionManagement {
  result: RetentionManagementResult;
  channel: RetentionManagementChannel;
  note: string | null;
  promiseDate: Date | null;
  nextManagementDate: Date | null;
}

export function normalizeRetentionManagement(
  input: RetentionManagementPolicyInput,
): NormalizedRetentionManagement {
  const result = input.result.trim().toUpperCase();
  const channel = input.channel.trim().toUpperCase();
  if (!(RETENTION_MANAGEMENT_RESULTS as readonly string[]).includes(result)) {
    throw new Error("Resultado de gestión inválido.");
  }
  if (!(RETENTION_MANAGEMENT_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error("Canal de contacto inválido.");
  }
  assertCalendarDate(input.businessToday, "businessToday");
  assertOptionalFutureDate(input.promiseDate, input.businessToday, "La fecha prometida");
  assertOptionalFutureDate(
    input.nextManagementDate,
    input.businessToday,
    "La próxima gestión",
  );

  const note = input.note?.trim() || null;
  if ((note?.length ?? 0) > 1000) {
    throw new Error("La nota no puede superar 1000 caracteres.");
  }
  if (result === "PROMESA_PAGO" && !input.promiseDate) {
    throw new Error("Una promesa de pago requiere su fecha prometida.");
  }
  if (result === "NO_DESEA_RENOVAR" && (note?.length ?? 0) < 5) {
    throw new Error("Registre una nota breve cuando el socio no desea renovar.");
  }

  return {
    result: result as RetentionManagementResult,
    channel: channel as RetentionManagementChannel,
    note,
    promiseDate: input.promiseDate ?? null,
    nextManagementDate:
      input.nextManagementDate
      ?? (result === "PROMESA_PAGO" ? input.promiseDate ?? null : null),
  };
}

function assertOptionalFutureDate(
  date: Date | null | undefined,
  businessToday: Date,
  label: string,
): void {
  if (!date) return;
  assertCalendarDate(date, label);
  const days = calendarDayDiff(businessToday, date);
  if (days < 0) throw new Error(`${label} no puede estar en el pasado.`);
  if (days > 366) throw new Error(`${label} no puede superar un año.`);
}

function assertCalendarDate(value: Date, name: string): void {
  if (
    Number.isNaN(value.getTime())
    || value.getUTCHours() !== 0
    || value.getUTCMinutes() !== 0
    || value.getUTCSeconds() !== 0
    || value.getUTCMilliseconds() !== 0
  ) {
    throw new Error(`${name} debe ser una fecha de calendario UTC.`);
  }
}


