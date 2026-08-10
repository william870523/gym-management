import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
  type MoneyInput,
} from "./treasury-ledger-policy";

export type TreasuryPeriodType = "DIARIO" | "SEMANAL" | "MENSUAL" | "PERSONALIZADO";
export class TreasuryPeriodClosePolicyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TreasuryPeriodClosePolicyError";
  }
}
export type NormalizedTreasuryPeriod = {
  fecha_inicio: Date; fecha_fin_exclusiva: Date; desde: string; hasta: string;
  dias: number; tipo_periodo: TreasuryPeriodType;
};
const DAY_MS = 86_400_000;
function fail(code: string, message: string): never {
  throw new TreasuryPeriodClosePolicyError(code, message);
}
function parseCalendarDate(value: unknown, label: string): Date {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) fail("FECHA_INVALIDA", `${label} debe usar el formato YYYY-MM-DD.`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== text) fail("FECHA_INVALIDA", `${label} no es una fecha calendario válida.`);
  return date;
}
function dateText(value: Date) { return value.toISOString().slice(0, 10); }
function addCalendarDays(value: Date, days: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days));
}
function normalizeType(value: unknown): TreasuryPeriodType {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!["DIARIO", "SEMANAL", "MENSUAL", "PERSONALIZADO"].includes(normalized)) fail("TIPO_INVALIDO", "Seleccione día, semana, mes o personalizado.");
  return normalized as TreasuryPeriodType;
}
function isNaturalMonth(start: Date, endInclusive: Date) {
  if (start.getUTCDate() !== 1) return false;
  const nextMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return dateText(addCalendarDays(endInclusive, 1)) === dateText(nextMonth);
}
export function normalizePeriodRange(input: { desde: unknown; hasta: unknown; tipo: unknown; fechaActualNegocio: unknown }): NormalizedTreasuryPeriod {
  const start = parseCalendarDate(input.desde, "La fecha inicial");
  const endInclusive = parseCalendarDate(input.hasta, "La fecha final");
  const today = parseCalendarDate(input.fechaActualNegocio, "La fecha comercial actual");
  const type = normalizeType(input.tipo);
  if (start > endInclusive) fail("RANGO_INVERTIDO", "La fecha inicial no puede ser posterior a la final.");
  const days = Math.round((endInclusive.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days > 366) fail("RANGO_EXCESIVO", "El período no puede superar 366 días.");
  if (endInclusive > today) fail("RANGO_FUTURO", "El período no puede incluir fechas comerciales futuras.");
  const naturalMonth = isNaturalMonth(start, endInclusive);
  if (type === "DIARIO" && days !== 1) fail("TIPO_INCOHERENTE", "Un cierre diario debe abarcar exactamente un día.");
  if (type === "SEMANAL" && (days !== 7 || start.getUTCDay() !== 1 || endInclusive.getUTCDay() !== 0)) fail("TIPO_INCOHERENTE", "Un cierre semanal debe abarcar de lunes a domingo.");
  if (type === "MENSUAL" && !naturalMonth) fail("TIPO_INCOHERENTE", "Un cierre mensual debe abarcar un mes natural completo.");
  if (type === "PERSONALIZADO" && naturalMonth) fail("USE_MENSUAL", "Ese rango es un mes natural; use el cierre mensual formal.");
  return { fecha_inicio: start, fecha_fin_exclusiva: addCalendarDays(endInclusive, 1), desde: dateText(start), hasta: dateText(endInclusive), dias: days, tipo_periodo: type };
}
export function presetDia(fecha: unknown) {
  const day = parseCalendarDate(fecha, "La fecha");
  return { desde: dateText(day), hasta: dateText(day), tipo: "DIARIO" as const };
}
export function presetSemana(fecha: unknown) {
  const day = parseCalendarDate(fecha, "La fecha");
  const isoDay = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  const start = addCalendarDays(day, 1 - isoDay);
  return { desde: dateText(start), hasta: dateText(addCalendarDays(start, 6)), tipo: "SEMANAL" as const };
}
export function presetMes(yearValue: unknown, monthValue: unknown) {
  const year = Number(yearValue); const month = Number(monthValue);
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) fail("FECHA_INVALIDA", "El año y el mes no son válidos.");
  return { desde: dateText(new Date(Date.UTC(year, month - 1, 1))), hasta: dateText(new Date(Date.UTC(year, month, 0))), tipo: "MENSUAL" as const };
}
export type PeriodMetricMovement = {
  movimiento_id: string; moneda_id: string; cuenta_id?: string | null; fecha_negocio: string;
  direccion: "ENTRADA" | "SALIDA"; monto: MoneyInput; origen_tipo: string; origen_id: string;
  contramovimiento_de_id?: string | null; pago_cliente_id?: string | null; cliente_id?: string | null;
  cobrado_por_user_id?: string | null;
};
export type PeriodMetricClose = { cuenta_id: string; fecha_negocio: string };
export function computePeriodMetrics(movements: PeriodMetricMovement[], closes: PeriodMetricClose[]) {
  const closeKeys = new Set(closes.map((row) => `${row.cuenta_id}|${row.fecha_negocio}`));
  return [...new Set(movements.map((row) => row.moneda_id))].sort().map((currencyId) => {
    const rows = movements.filter((row) => row.moneda_id === currencyId);
    let gross = 0n, change = 0n, reversals = 0n, entries = 0n, exits = 0n, unattributed = 0n;
    const paymentIds = new Set<string>(), clientIds = new Set<string>(), accountDays = new Set<string>();
    for (const row of rows) {
      const amount = treasuryMoneyToMinor(row.monto);
      if (row.direccion === "ENTRADA") entries += amount; else exits += amount;
      const isReversal = Boolean(row.contramovimiento_de_id) || row.origen_tipo.includes("REVERS");
      if (isReversal && ["PAGO_CLIENTE", "PAGO_CAMBIO", "PAGO_REVERSO", "PAGO_REVERSION"].some((kind) => row.origen_tipo.includes(kind))) reversals += row.direccion === "SALIDA" ? amount : -amount;
      else if (row.origen_tipo === "PAGO_CLIENTE" && row.direccion === "ENTRADA") { gross += amount; if (!row.cobrado_por_user_id) unattributed += amount; }
      else if (row.origen_tipo === "PAGO_CAMBIO" && row.direccion === "SALIDA") change += amount;
      const paymentId = row.pago_cliente_id ?? (["PAGO_CLIENTE", "PAGO_CAMBIO"].includes(row.origen_tipo) ? row.origen_id : null);
      if (paymentId) paymentIds.add(paymentId); if (row.cliente_id) clientIds.add(row.cliente_id);
      if (row.cuenta_id) accountDays.add(`${row.cuenta_id}|${row.fecha_negocio}`);
    }
    const closedDays = [...accountDays].filter((key) => closeKeys.has(key)).length;
    return { moneda_id: currencyId, cobro_bruto: treasuryMinorToMoney(gross), cambio_entregado: treasuryMinorToMoney(change), anulaciones: treasuryMinorToMoney(reversals), cobro_neto: treasuryMinorToMoney(gross - change - reversals), flujo_neto: treasuryMinorToMoney(entries - exits), cobros_cantidad_distinta: paymentIds.size, clientes_cantidad_distinta: clientIds.size, cuenta_dias_actividad: accountDays.size, cuenta_dias_cerrados: closedDays, cobertura_diaria: accountDays.size === 0 ? 100 : Number(((closedDays / accountDays.size) * 100).toFixed(1)), sin_atribuir_importe: treasuryMinorToMoney(unattributed) };
  });
}
export const TREASURY_PERIOD_BLOCKER_CODES = ["CUENTA_DIA_SIN_CIERRE", "SOLICITUD_ARQUEO_PENDIENTE", "MOVIMIENTO_SIN_CUENTA", "MOVIMIENTO_REQUIERE_REVISION", "MOVIMIENTO_TARDIO_SIN_CONCILIAR", "INTEGRIDAD_CIERRE_O_CONCILIACION_INVALIDA", "CIERRE_MENSUAL_INTEGRO_NO_VERIFICABLE", "PAGO_NUEVO_SIN_COBRADOR", "SYNC_PENDIENTE", "REFERENCIA_OTRO_GIMNASIO"] as const;
export type TreasuryPeriodBlockerCode = typeof TREASURY_PERIOD_BLOCKER_CODES[number];
export function computeSigningBlockers(input: Partial<Record<TreasuryPeriodBlockerCode, number>>) {
  return TREASURY_PERIOD_BLOCKER_CODES.flatMap((code) => Number(input[code] ?? 0) > 0 ? [{ codigo: code, cantidad: Number(input[code]) }] : []);
}
export function normalizePeriodReason(value: unknown, action: "cerrar" | "reabrir") {
  const reason = String(value ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < 10 || reason.length > 500) fail("MOTIVO_INVALIDO", `El motivo para ${action} debe tener entre 10 y 500 caracteres.`);
  return reason;
}
export function normalizePeriodOperationId(value: unknown) {
  const id = String(value ?? "").trim();
  if (id.length < 8 || id.length > 191) fail("OPERACION_INVALIDA", "La operación no es válida.");
  return id;
}
export function canSignTreasuryPeriod(role: unknown) { return ["admin", "administrador", "accounting", "contabilidad"].includes(String(role ?? "").trim().toLowerCase()); }
export function canReopenTreasuryPeriod(role: unknown) { return ["admin", "administrador"].includes(String(role ?? "").trim().toLowerCase()); }
