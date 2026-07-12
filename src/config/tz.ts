// gym-local-api / gym-remote-api — utilidades de zona horaria.
//
// Principio: TODA marca de tiempo se almacena y transmite en UTC (instante
// absoluto, `...Z`). Solo al mostrar o calcular "inicio de día / hoy" se
// convierte a la zona del gimnasio (Gym.timezone).
//
// El proceso debe arrancar con TZ=UTC (ver src/config/tz-preload.ts). Estas
// funciones normalizan entradas externas; nowUtc usa el reloj calibrado.
import { trustedClock } from "./trusted-clock";

/**
 * Instante actual (UTC si el proceso arrancó con TZ=UTC).
 * Use este helper en vez de `new Date()` para dejar clara la intención.
 */
export function nowUtc(): Date {
  return trustedClock.nowUtc();
}

/**
 * Normaliza un valor de fecha a string ISO con `Z` (UTC).
 * Acepta Date o string. Si el string no trae offset, se asume que ya es UTC
 * (porque el sistema guarda en UTC) y se le añade la `Z`.
 */
export function toUtcIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  if (s === "") return null;
  // Si ya trae offset (Z, +HH:MM, +HHMM) lo respeta.
  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s).toISOString();
  }
  // Sin offset: asumimos UTC (contrato del sistema).
  return new Date(s.endsWith("Z") ? s : `${s}Z`).toISOString();
}

/**
 * Interpreta un valor de fecha como UTC y devuelve un Date (instante absoluto).
 * - Date: lo retorna tal cual.
 * - String con offset (Z/+HH:MM): interpretado correctamente.
 * - String sin offset: se asume UTC (se añade `Z`).
 * - null/undefined/"": devuelve null.
 */
export function parseUtc(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (s === "") return null;
  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(s);
  }
  return new Date(`${s}Z`);
}

/**
 * Devuelve los componentes {año, mes, día} de la fecha `ref` tal como se ven en
 * la zona horaria IANA indicada (p.ej. "America/Havana"). Usa Intl nativo, sin
 * librerías.
 */
export function datePartsInZone(
  timeZone: string,
  ref: Date = new Date(),
): { year: number; month: number; day: number; hour: number; minute: number } {
  // Formato fijo y parseable: YYYY-MM-DD HH:mm
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(ref);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24, // hour12:false puede dar "24" en algunos runtimes
    minute: Number(get("minute")),
  };
}

/**
 * Corazón del fix de fechas: calcula el inicio (00:00:00.000) y fin
 * (23:59:59.999) del día natural en la zona del gimnasio, y devuelve sus
 * equivalentes UTC para usar en filtros de BD (`created_at BETWEEN ...`).
 *
 * Ejemplo: si la zona es America/Havana (UTC-5) y son las 2026-07-05 03:00 UTC,
 * en La Habana todavía es 2026-07-05 22:00 del día anterior… calcula el día
 * "Havana" correcto y devuelve el window UTC que lo cubre.
 */
export function startOfDayInZone(
  timeZone: string,
  ref: Date = new Date(),
): { startUtc: Date; endUtc: Date } {
  const { year, month, day } = datePartsInZone(timeZone, ref);
  // El día natural en la zona inicia a las 00:00:00 de esa zona.
  // Date.UTC da el instante absoluto del 00:00:00 UTC; pero necesitamos el
  // 00:00:00 *de la zona*, que es un instante distinto. Lo calculamos
  // indirectamente: formateamos "mañana a las 12:00" en la zona y comparamos
  // con el 12:00 UTC del mismo día natural → la diferencia es el offset.
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = datePartsInZone(timeZone, noonUtc);
  // offset en ms: cuánto se desplaza la zona respecto a UTC a esa hora.
  const offsetMs =
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) -
    noonUtc.getTime();
  const startUtc = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offsetMs,
  );
  const endUtc = new Date(
    Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMs,
  );
  return { startUtc, endUtc };
}

/**
 * Formatea una fecha en una zona IANA usando Intl. Opciones estándar de
 * Intl.DateTimeFormat (p.ej. { dateStyle: 'short', timeStyle: 'short' }).
 */
export function formatInZone(
  date: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "short",
    timeStyle: "short",
  },
): string {
  const d = date instanceof Date ? date : (parseUtc(date) ?? new Date(date));
  return new Intl.DateTimeFormat("es", { ...options, timeZone }).format(d);
}

/** Zona horaria IANA por defecto del sistema. */
export const DEFAULT_GYM_TIMEZONE = "Etc/UTC";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
