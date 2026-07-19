import { describe, expect, test } from "bun:test";
import {
  ExchangeRateSurchargePolicyError,
  normalizeExchangeRateSurcharges,
  parseExchangeRateSurcharges,
  serializeExchangeRateSurcharges,
  surchargeBreakdown,
  surchargeMinor,
} from "./exchange-rate-surcharge-policy";

describe("exchange rate surcharge policy", () => {
  test("normaliza porcentajes válidos y descarta ceros", () => {
    const result = normalizeExchangeRateSurcharges({
      "tp-transfer": "5",
      "tp-card": "2.50",
      "tp-cash": "0",
    });
    expect(result).toEqual({ "tp-transfer": "5.00", "tp-card": "2.50" });
  });

  test("rechaza porcentajes fuera de 0-100 o no decimales", () => {
    expect(() => normalizeExchangeRateSurcharges({ tp: "101" }))
      .toThrow(ExchangeRateSurchargePolicyError);
    expect(() => normalizeExchangeRateSurcharges({ tp: "-1" }))
      .toThrow("entre 0 y 100");
    expect(() => normalizeExchangeRateSurcharges({ tp: "abc" }))
      .toThrow("decimal");
    expect(() => normalizeExchangeRateSurcharges({ tp: "5.123" }))
      .toThrow("decimal");
  });

  test("serializa a null cuando no hay recargos", () => {
    expect(serializeExchangeRateSurcharges(null)).toBeNull();
    expect(serializeExchangeRateSurcharges({})).toBeNull();
    expect(serializeExchangeRateSurcharges({ tp: "0" })).toBeNull();
    expect(serializeExchangeRateSurcharges({ tp: "5" }))
      .toBe('{"tp":"5.00"}');
  });

  test("parsea lo persistido y explica un JSON corrupto", () => {
    expect(parseExchangeRateSurcharges(null)).toEqual({});
    expect(parseExchangeRateSurcharges('{"tp":"5.00"}'))
      .toEqual({ tp: "5.00" });
    expect(() => parseExchangeRateSurcharges("{corrupt"))
      .toThrow("no son legibles");
  });

  test("calcula el recargo aplicando redondeo al entero superior (ceil)", () => {
    const surcharges = { "tp-transfer": "5.00" };
    // 4500.00 CUP × 5 % = 225.00 exacto → 225.00
    expect(surchargeMinor(450000n, surcharges, "tp-transfer")).toBe(22500n);
    // método sin recargo → 0
    expect(surchargeMinor(450000n, surcharges, "tp-cash")).toBe(0n);
    // 105.00 × 5.00 % = 5.25 → redondea hacia arriba al entero 6.00 (600n)
    expect(surchargeMinor(10500n, { tp: "5.00" }, "tp")).toBe(600n);
    // 100.00 × 5.40 % = 5.40 → redondea hacia arriba al entero 6.00 (600n)
    expect(surchargeMinor(10000n, { tp: "5.40" }, "tp")).toBe(600n);
  });

  test("no pierde centavos en importes grandes (mayores a 2^53)", () => {
    const surcharges = { tp: "1.00" };
    const base = 9007199254740993n; // > Number.MAX_SAFE_INTEGER
    expect(surchargeMinor(base, surcharges, "tp")).toBe(90071992547500n);
  });

  test("desglosa base, recargo entero y total para el recibo", () => {
    const result = surchargeBreakdown("105.00", { tp: "5.00" }, "tp");
    expect(result).toEqual({
      base: "105.00",
      recargo_pct: "5.00",
      recargo: "6.00",
      total: "111.00",
    });
    const without = surchargeBreakdown("4500.00", {}, "tp");
    expect(without.recargo).toBe("0.00");
    expect(without.recargo_pct).toBeNull();
    expect(without.total).toBe("4500.00");
  });
});
