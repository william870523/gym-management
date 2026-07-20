import { describe, expect, test } from "bun:test";
import {
  ClientDiscountSettingsValidationError,
  CLIENT_OLD_DISCOUNT_KEY,
  DEFAULT_CLIENT_OLD_DISCOUNT_PCT,
  resolveClientDiscountPct,
  validateClientDiscountPct,
} from "./client-discount-settings";

describe("client discount settings", () => {
  test("la sede prevalece sobre el valor global", () => {
    const resolved = resolveClientDiscountPct([
      { clave: CLIENT_OLD_DISCOUNT_KEY, valor: "20.00", gym_id: "GLOBAL" },
      { clave: CLIENT_OLD_DISCOUNT_KEY, valor: "10.50", gym_id: "gym-1" },
    ], "gym-1");
    expect(resolved).toEqual({ value: "10.50", source: "GYM" });
  });

  test("sin fila propia cae al global", () => {
    const resolved = resolveClientDiscountPct([
      { clave: CLIENT_OLD_DISCOUNT_KEY, valor: "20.00", gym_id: "GLOBAL" },
    ], "gym-1");
    expect(resolved).toEqual({ value: "20.00", source: "GLOBAL" });
  });

  test("sin filas cae al default 16.67", () => {
    const resolved = resolveClientDiscountPct([], "gym-1");
    expect(resolved).toEqual({ value: DEFAULT_CLIENT_OLD_DISCOUNT_PCT, source: "DEFAULT" });
  });

  test("un valor inválido (fuera de rango) vuelve al default", () => {
    const resolved = resolveClientDiscountPct([
      { clave: CLIENT_OLD_DISCOUNT_KEY, valor: "150.00", gym_id: "gym-1" },
    ], "gym-1");
    expect(resolved.source).toBe("DEFAULT");
  });

  test("un valor no numérico vuelve al default", () => {
    const resolved = resolveClientDiscountPct([
      { clave: CLIENT_OLD_DISCOUNT_KEY, valor: "abc", gym_id: "gym-1" },
    ], "gym-1");
    expect(resolved.source).toBe("DEFAULT");
  });

  test("valida y normaliza el % recibido", () => {
    expect(validateClientDiscountPct(16.67)).toBe("16.67");
    expect(validateClientDiscountPct("0")).toBe("0.00");
    expect(validateClientDiscountPct("100")).toBe("100.00");
  });

  test("rechaza % fuera de rango o mal formado", () => {
    expect(() => validateClientDiscountPct("150")).toThrow(
      ClientDiscountSettingsValidationError,
    );
    expect(() => validateClientDiscountPct("-1")).toThrow(
      ClientDiscountSettingsValidationError,
    );
    expect(() => validateClientDiscountPct("abc")).toThrow(
      ClientDiscountSettingsValidationError,
    );
  });
});
