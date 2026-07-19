import { describe, expect, test } from "bun:test";
import { classifyRetention, retentionMatureCutoff } from "./retention-policy";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("remote retention policy contract", () => {
  test("mantiene salida en el sexto dia y recuperacion historica", () => {
    const base = {
      membershipState: "VENCIDA",
      dueDate: day("2026-07-10"),
      businessToday: day("2026-07-16"),
      graceDays: 5,
      horizonDays: 7,
    };
    expect(classifyRetention(base)?.state).toBe("SALIDA");
    expect(classifyRetention({ ...base, renewalEffectiveDate: day("2026-07-20") })?.state).toBe("RECUPERADO");
  });

  test("no consolida el quinto dia de gracia", () => {
    expect(retentionMatureCutoff(day("2026-07-15"), 5).toISOString())
      .toBe("2026-07-09T00:00:00.000Z");
    expect(retentionMatureCutoff(day("2026-07-16"), 5).toISOString())
      .toBe("2026-07-10T00:00:00.000Z");
  });
});
