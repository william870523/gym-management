import { describe, expect, it } from "bun:test";
import {
  baseFactor,
  ExchangeRevaluationPolicyError,
  revalueLine,
  summarizeRevaluation,
  type RevaluationLineInput,
} from "./exchange-revaluation-policy";

const EUR = "cur-eur";
const CUP = "cur-cup";

// Tasa base→target: 1 EUR = N CUP (moneda base = EUR).
const eurToCup = (rate: number) => ({
  monedaIdBase: EUR,
  monedaIdTarget: CUP,
  exchangeRate: rate,
});
// Tasa target→base: 1 CUP = N EUR (orientación inversa).
const cupToEur = (rate: number) => ({
  monedaIdBase: CUP,
  monedaIdTarget: EUR,
  exchangeRate: rate,
});

describe("baseFactor", () => {
  it("convierte CUP→EUR con tasa base→target usando 1/tasa", () => {
    expect(baseFactor(eurToCup(300), CUP, EUR)).toBeCloseTo(1 / 300, 10);
  });

  it("convierte CUP→EUR con tasa target→base usando la tasa directa", () => {
    expect(baseFactor(cupToEur(0.0033), CUP, EUR)).toBeCloseTo(0.0033, 10);
  });

  it("es 1 cuando la moneda ya es la base", () => {
    expect(baseFactor(eurToCup(300), EUR, EUR)).toBe(1);
  });

  it("rechaza tasas no positivas", () => {
    expect(() => baseFactor(eurToCup(0), CUP, EUR)).toThrow(
      ExchangeRevaluationPolicyError,
    );
  });

  it("rechaza una tasa de un par que no corresponde", () => {
    const otra = { monedaIdBase: "cur-usd", monedaIdTarget: "cur-mxn", exchangeRate: 20 };
    expect(() => baseFactor(otra, CUP, EUR)).toThrow(
      ExchangeRevaluationPolicyError,
    );
  });
});

describe("revalueLine — ejemplo del dueño (paga en CUP, el euro se encarece)", () => {
  it("2700 CUP cobrados a 300 valen 9.00 EUR al cobro y 5.40 al corte (pérdida 3.60)", () => {
    const line = revalueLine(
      {
        reference: "pago-1",
        weakCurrencyId: CUP,
        amount: "2700.00",
        collectionRate: eurToCup(300),
        cutoffRate: eurToCup(500),
      },
      EUR,
    );
    expect(line.baseAtCollection).toBe("9.00");
    expect(line.baseAtCutoff).toBe("5.40");
    expect(line.revaluation).toBe("-3.60"); // pérdida cambiaria
  });

  it("da el mismo resultado con la tasa en orientación inversa (target→base)", () => {
    const line = revalueLine(
      {
        reference: "pago-1",
        weakCurrencyId: CUP,
        amount: "2700.00",
        collectionRate: cupToEur(1 / 300),
        cutoffRate: cupToEur(1 / 500),
      },
      EUR,
    );
    expect(line.baseAtCollection).toBe("9.00");
    expect(line.baseAtCutoff).toBe("5.40");
    expect(line.revaluation).toBe("-3.60");
  });

  it("marca la línea sin revaluar cuando falta la tasa al corte", () => {
    const line = revalueLine(
      {
        reference: "pago-1",
        weakCurrencyId: CUP,
        amount: "2700.00",
        collectionRate: eurToCup(300),
        cutoffRate: null,
      },
      EUR,
    );
    expect(line.baseAtCollection).toBe("9.00");
    expect(line.baseAtCutoff).toBeNull();
    expect(line.revaluation).toBeNull();
  });

  it("una revaluación positiva (la moneda se fortalece) es ganancia", () => {
    const line = revalueLine(
      {
        reference: "pago-2",
        weakCurrencyId: CUP,
        amount: "3000.00",
        collectionRate: eurToCup(500),
        cutoffRate: eurToCup(300),
      },
      EUR,
    );
    expect(line.baseAtCollection).toBe("6.00");
    expect(line.baseAtCutoff).toBe("10.00");
    expect(line.revaluation).toBe("4.00"); // ganancia
  });
});

describe("summarizeRevaluation", () => {
  const lines: RevaluationLineInput[] = [
    {
      reference: "a",
      weakCurrencyId: CUP,
      amount: "2700.00",
      collectionRate: eurToCup(300),
      cutoffRate: eurToCup(500),
    },
    {
      reference: "b",
      weakCurrencyId: CUP,
      amount: "1500.00",
      collectionRate: eurToCup(300),
      cutoffRate: eurToCup(500),
    },
    {
      // Sin tasa al corte: cuenta pero no revalúa ni ensucia la diferencia.
      reference: "c",
      weakCurrencyId: CUP,
      amount: "600.00",
      collectionRate: eurToCup(300),
      cutoffRate: null,
    },
  ];

  it("agrega por moneda y suma solo las líneas revaluables", () => {
    const summary = summarizeRevaluation(lines, EUR);
    expect(summary.currencies).toHaveLength(1);
    const cup = summary.currencies[0];
    expect(cup.weakCurrencyId).toBe(CUP);
    expect(cup.lines).toBe(3);
    expect(cup.amountWeak).toBe("4800.00"); // 2700 + 1500 + 600 (todas)
    expect(cup.baseAtCollection).toBe("14.00"); // 9.00 + 5.00 (solo revaluables)
    expect(cup.baseAtCutoff).toBe("8.40"); // 5.40 + 3.00
    expect(cup.revaluation).toBe("-5.60"); // 8.40 − 14.00
    expect(cup.linesWithoutCutoffRate).toBe(1);
    expect(summary.totalRevaluation).toBe("-5.60");
    expect(summary.linesWithoutCutoffRate).toBe(1);
  });

  it("ignora las líneas cuya moneda ya es la base", () => {
    const summary = summarizeRevaluation(
      [
        {
          reference: "eur",
          weakCurrencyId: EUR,
          amount: "10.00",
          collectionRate: eurToCup(300),
          cutoffRate: eurToCup(500),
        },
      ],
      EUR,
    );
    expect(summary.currencies).toHaveLength(0);
    expect(summary.totalRevaluation).toBe("0.00");
    expect(summary.lines).toBe(0);
  });
});
