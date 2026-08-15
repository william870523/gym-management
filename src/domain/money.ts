export type DecimalValue =
  | string
  | number
  | bigint
  | { toString(): string; toFixed?(scale: number): string };

export type DecimalInput =
  | DecimalValue
  | null
  | undefined;

export class MoneyContractError extends Error {}

const powerOfTen = (scale: number) => {
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
    throw new MoneyContractError("La escala decimal debe estar entre 0 y 12.");
  }
  return 10n ** BigInt(scale);
};

function decimalText(value: DecimalInput, scale: number): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new MoneyContractError("El valor monetario debe ser finito.");
    }
    // Compatibilidad de transición: un number ya perdió su representación
    // decimal original; se redondea una sola vez al entrar al contrato.
    const fixed = value.toFixed(scale);
    return fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  }
  if (value && typeof value === "object" && typeof value.toFixed === "function") {
    return value.toFixed(scale);
  }
  return String(value ?? "").trim().replace(",", ".");
}

export function decimalToUnits(value: DecimalInput, scale = 2): bigint {
  powerOfTen(scale);
  const text = decimalText(value, scale);
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
    throw new MoneyContractError("El valor monetario no es un decimal válido.");
  }
  const negative = text.startsWith("-");
  const unsigned = /^[+-]/.test(text) ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const discarded = fraction.slice(scale);
  if (discarded && /[1-9]/.test(discarded)) {
    throw new MoneyContractError(`El valor admite como máximo ${scale} decimales.`);
  }
  const units = BigInt(whole) * powerOfTen(scale) +
    BigInt(fraction.slice(0, scale).padEnd(scale, "0") || "0");
  return negative ? -units : units;
}

export function unitsToDecimal(value: bigint, scale = 2): string {
  const factor = powerOfTen(scale);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / factor;
  if (scale === 0) return `${negative ? "-" : ""}${whole}`;
  const fraction = String(absolute % factor).padStart(scale, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export const normalizeMoney = (value: DecimalInput) =>
  unitsToDecimal(decimalToUnits(value, 2), 2);

export const normalizeRate = (value: DecimalInput) =>
  unitsToDecimal(decimalToUnits(value, 8), 8);

export function sumMoney(values: Iterable<DecimalInput>): string {
  let total = 0n;
  for (const value of values) total += decimalToUnits(value, 2);
  return unitsToDecimal(total, 2);
}

export function subtractMoney(left: DecimalInput, right: DecimalInput): string {
  return unitsToDecimal(decimalToUnits(left, 2) - decimalToUnits(right, 2), 2);
}

export function multiplyMoneyByRate(
  amount: DecimalInput,
  rate: DecimalInput,
  rounding: "HALF_UP" | "CEIL" = "HALF_UP",
): string {
  const amountMinor = decimalToUnits(amount, 2);
  const rateUnits = decimalToUnits(rate, 8);
  const denominator = powerOfTen(8);
  const product = amountMinor * rateUnits;
  const negative = product < 0n;
  const absolute = negative ? -product : product;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const increment = rounding === "CEIL"
    ? (remainder === 0n ? 0n : 1n)
    : (remainder * 2n >= denominator ? 1n : 0n);
  const result = quotient + increment;
  return unitsToDecimal(negative ? -result : result, 2);
}
