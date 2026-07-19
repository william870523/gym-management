import { describe, expect, test } from "bun:test";
import { buildFixedObligationSchedule } from "./fixed-obligation-policy";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("fixed obligation policy", () => {
  test("generates only completed monthly cuts", () => {
    const result = buildFixedObligationSchedule({
      fixedAmount: "300.00",
      profileStart: day("2026-06-01"),
      profileEnd: null,
      throughDate: day("2026-07-14"),
      earningMethod: "PERIODOS_IGUALES",
      payoutFrequency: "MENSUAL",
      cutoffDay: 15,
    });
    expect(result).toHaveLength(1);
    expect(result[0].periodStart.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(result[0].periodEnd.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(result[0].amount).toBe("300.00");
  });

  test("prorates a partial weekly cut by service days", () => {
    const result = buildFixedObligationSchedule({
      fixedAmount: "100.00",
      profileStart: day("2026-07-01"),
      profileEnd: null,
      throughDate: day("2026-07-03"),
      earningMethod: "DIAS_SERVICIO",
      payoutFrequency: "SEMANAL",
      cutoffDay: 5,
    });
    expect(result).toHaveLength(1);
    expect(result[0].coveredDays).toBe(2);
    expect(result[0].cycleDays).toBe(7);
    expect(result[0].amount).toBe("28.57");
  });

  test("closes and makes payable an incomplete final period", () => {
    const result = buildFixedObligationSchedule({
      fixedAmount: "300.00",
      profileStart: day("2026-06-15"),
      profileEnd: day("2026-07-10"),
      throughDate: day("2026-07-14"),
      earningMethod: "DIAS_SERVICIO",
      payoutFrequency: "MENSUAL",
      cutoffDay: 15,
    });
    expect(result).toHaveLength(1);
    expect(result[0].payableDate.toISOString()).toBe("2026-07-10T00:00:00.000Z");
    expect(result[0].coveredDays).toBe(25);
    expect(result[0].cycleDays).toBe(30);
    expect(result[0].amount).toBe("250.00");
  });

  test("extraordinary profiles do not create automatic obligations", () => {
    expect(buildFixedObligationSchedule({
      fixedAmount: "100.00",
      profileStart: day("2026-01-01"),
      profileEnd: null,
      throughDate: day("2026-07-14"),
      earningMethod: "DIAS_SERVICIO",
      payoutFrequency: "EXTRAORDINARIA",
      cutoffDay: null,
    })).toEqual([]);
  });
});
