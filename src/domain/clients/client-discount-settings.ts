/**
 * R5.3 — Configuración del descuento global por categoría de cliente.
 *
 * Una sola clave en `ConfiguracionSistema`:
 * `DESCUENTO_CLIENTE_VIEJO_PCT` (0–100, hasta 2 decimales). El default
 * derivado de los precios conocidos (10/12, 25/30) es ≈16.67 %, pero por plan
 * se puede fijar una excepción de precio fijo que anula este %.
 */
import { treasuryMoneyToMinor } from "../treasury-ledger-policy";

export const CLIENT_OLD_DISCOUNT_KEY = "DESCUENTO_CLIENTE_VIEJO_PCT";
/** 16.67 % derivado de los precios conocidos 10/12 y 25/30. Ajustable. */
export const DEFAULT_CLIENT_OLD_DISCOUNT_PCT = "16.67";
export const CLIENT_OLD_DISCOUNT_LIMITS = { min: 0, max: 100 } as const;

export type ClientDiscountSource = "GYM" | "GLOBAL" | "DEFAULT";

export interface ClientDiscountConfigurationRow {
  clave: string;
  valor: string;
  gym_id: string;
}

export class ClientDiscountSettingsValidationError extends Error {}

/** Devuelve { valor, source } con resolución gym → GLOBAL → DEFAULT. */
export function resolveClientDiscountPct(
  rows: ClientDiscountConfigurationRow[],
  gymId: string,
): { value: string; source: ClientDiscountSource } {
  const row = rows.find(
    (item) => item.clave === CLIENT_OLD_DISCOUNT_KEY && item.gym_id === gymId,
  ) ?? rows.find(
    (item) => item.clave === CLIENT_OLD_DISCOUNT_KEY && item.gym_id === "GLOBAL",
  );
  if (!row) {
    return { value: DEFAULT_CLIENT_OLD_DISCOUNT_PCT, source: "DEFAULT" };
  }
  try {
    const minor = treasuryMoneyToMinor(row.valor);
    if (
      minor < CLIENT_OLD_DISCOUNT_LIMITS.min ||
      minor > CLIENT_OLD_DISCOUNT_LIMITS.max * 100
    ) {
      return { value: DEFAULT_CLIENT_OLD_DISCOUNT_PCT, source: "DEFAULT" };
    }
    return {
      value: row.valor,
      source: row.gym_id === gymId ? "GYM" : "GLOBAL",
    };
  } catch {
    return { value: DEFAULT_CLIENT_OLD_DISCOUNT_PCT, source: "DEFAULT" };
  }
}

/** Valida y normaliza el % recibido de la API. */
export function validateClientDiscountPct(value: unknown): string {
  let pctMinor: bigint;
  try {
    pctMinor = treasuryMoneyToMinor(String(value ?? ""));
  } catch {
    throw new ClientDiscountSettingsValidationError(
      "El porcentaje de descuento debe ser un decimal con hasta dos cifras.",
    );
  }
  if (
    pctMinor < CLIENT_OLD_DISCOUNT_LIMITS.min ||
    pctMinor > CLIENT_OLD_DISCOUNT_LIMITS.max * 100
  ) {
    throw new ClientDiscountSettingsValidationError(
      `El porcentaje de descuento debe estar entre ${CLIENT_OLD_DISCOUNT_LIMITS.min} y ${CLIENT_OLD_DISCOUNT_LIMITS.max}.`,
    );
  }
  // Devuelve como entero con 2 decimales canónicos ("16.67", no "16.6700").
  const negative = pctMinor < 0n;
  const absolute = negative ? -pctMinor : pctMinor;
  const whole = absolute / 100n;
  const decimal = String(absolute % 100n).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${decimal}`;
}
