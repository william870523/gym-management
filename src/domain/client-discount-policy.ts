import {
  treasuryMinorToMoney,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

/**
 * R5.3 — Descuento por categoría de cliente (viejo/nuevo).
 *
 * El gimnasio distingue **cliente viejo** (anterior a la dolarización, siempre
 * con descuento) y **cliente nuevo** (precio normal). El descuento del viejo se
 * define globalmente en `ConfiguracionSistema` como un porcentaje
 * (`DESCUENTO_CLIENTE_VIEJO_PCT`) y, por plan, se puede fijar un **precio
 * excepción** (`PlanesPago.precio_viejo_excepcion`) que anula el porcentaje —
 * así se representan los precios conocidos 10/12 y 25/30 como cifras exactas,
 * no derivadas de un %.
 *
 * **Orden de capas al cobrar (crítico, no rompe R5.1):**
 *   1. precio de lista del plan;
 *   2. este descuento R5.3 → precio con descuento;
 *   3. recargo R5.1 por método de pago → precio final.
 *
 * El redondeo se aplica al **precio final**, no al descuento: 30 con 16.67 %
 * queda 24.999 y se cobra 25. Redondear el descuento daría 6 y cobraría 24,
 * concediendo más rebaja que la configurada.
 */

export class ClientDiscountPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientDiscountPolicyError";
  }
}

/** Categorías válidas de cliente. Ampliable (VIP, EMPRESA...). */
export type ClientCategory = "NUEVO" | "VIEJO";

export const CLIENT_CATEGORIES: readonly ClientCategory[] = ["NUEVO", "VIEJO"];

export function parseClientCategory(value: unknown): ClientCategory {
  const text = String(value ?? "").trim().toUpperCase();
  if (!CLIENT_CATEGORIES.includes(text as ClientCategory)) {
    throw new ClientDiscountPolicyError(
      `La categoría de cliente debe ser una de: ${CLIENT_CATEGORIES.join(", ")}.`,
    );
  }
  return text as ClientCategory;
}

export type DiscountMotivo =
  | "SIN_DESCUENTO"
  | "PORCENTAJE_GLOBAL"
  | "EXCEPCION_FIJA";

export interface DiscountBreakdown {
  /** Precio de lista del plan, sin descuento. */
  precio_lista: string;
  /** % aplicado, o null cuando se usó excepción fija o no hubo descuento. */
  descuento_pct: string | null;
  /** Importe descontado (siempre ≥ 0). */
  descuento: string;
  /** Precio final tras descuento, al que se aplicará después el recargo R5.1. */
  precio_final: string;
  motivo: DiscountMotivo;
}

export interface DiscountInput {
  listPrice: string;
  clientCategory: ClientCategory;
  /** % global (0–100, hasta 2 decimales); se ignora si hay excepción fija. */
  discountPct: string;
  /** Precio fijo para cliente VIEJO definido en el plan; null = usar %. */
  planFixedOldPrice: string | null;
}

/**
 * Descuento exacto en unidades menores para un precio de lista.
 * Devuelve el importe a descontar (≥ 0); nunca negativo.
 */
export function discountMinor(input: DiscountInput): bigint {
  const listMinor = treasuryMoneyToMinor(input.listPrice);
  if (listMinor < 0n) {
    throw new ClientDiscountPolicyError(
      "El precio de lista no puede ser negativo.",
    );
  }
  if (input.clientCategory !== "VIEJO") return 0n;

  // Excepción fija del plan: el descuento es la diferencia lista − excepción.
  if (input.planFixedOldPrice != null && input.planFixedOldPrice !== "") {
    const fixedMinor = treasuryMoneyToMinor(input.planFixedOldPrice);
    if (fixedMinor < 0n) {
      throw new ClientDiscountPolicyError(
        "El precio viejo excepción no puede ser negativo.",
      );
    }
    if (fixedMinor > listMinor) {
      throw new ClientDiscountPolicyError(
        "El precio viejo excepción no puede superar al precio de lista.",
      );
    }
    return listMinor - fixedMinor;
  }

  // Porcentaje global con ceil a entero superior (mismo patrón que R5.1).
  const pctMinor = treasuryMoneyToMinor(input.discountPct);
  if (pctMinor < 0n || pctMinor > 10000n) {
    throw new ClientDiscountPolicyError(
      "El porcentaje de descuento debe estar entre 0 y 100.",
    );
  }
  if (pctMinor === 0n) return 0n;
  const finalRawCents =
    (listMinor * (10000n - pctMinor) + 9999n) / 10000n;
  const finalWholeUnits = ((finalRawCents + 99n) / 100n) * 100n;
  const finalMinor = finalWholeUnits > listMinor ? listMinor : finalWholeUnits;
  return listMinor - finalMinor;
}

/** Desglose listo para recibo y para persistir en el snapshot del pago. */
export function discountBreakdown(input: DiscountInput): DiscountBreakdown {
  const listMinor = treasuryMoneyToMinor(input.listPrice);
  const discount = discountMinor(input);
  let motivo: DiscountMotivo;
  let pctOut: string | null;
  if (input.clientCategory !== "VIEJO") {
    motivo = "SIN_DESCUENTO";
    pctOut = null;
  } else if (
    input.planFixedOldPrice != null &&
    input.planFixedOldPrice !== ""
  ) {
    motivo = "EXCEPCION_FIJA";
    pctOut = null;
  } else {
    motivo = "PORCENTAJE_GLOBAL";
    pctOut = input.discountPct;
  }
  return {
    precio_lista: treasuryMinorToMoney(listMinor),
    descuento_pct: pctOut,
    descuento: treasuryMinorToMoney(discount),
    precio_final: treasuryMinorToMoney(listMinor - discount),
    motivo,
  };
}
