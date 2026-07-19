import { describe, expect, test } from "bun:test";
import {
  calculateOffboardingFinancialDestination,
  calculateUnusedMembershipValue,
} from "./trainer-offboarding-financial-policy";

describe("trainer offboarding financial policy", () => {
  test("prorratea el valor pagado por días de servicio sin perder centavos", () => {
    const result = calculateUnusedMembershipValue({
      paidMinor: 300_000,
      durationDays: 90,
      start: new Date("2026-06-15T00:00:00.000Z"),
      endExclusive: new Date("2026-09-13T00:00:00.000Z"),
      effectiveDate: new Date("2026-07-15T00:00:00.000Z"),
      membershipState: "ACTIVA",
    });
    expect(result.remainingDays).toBe(60);
    expect(result.unusedMinor).toBe(200_000);
    expect(result.unusedMinor + result.consumedMinor).toBe(300_000);
  });

  test("una pausa usa los días de servicio congelados", () => {
    const result = calculateUnusedMembershipValue({
      paidMinor: 9_000,
      durationDays: 90,
      start: new Date("2026-05-01T00:00:00.000Z"),
      endExclusive: new Date("2026-07-30T00:00:00.000Z"),
      effectiveDate: new Date("2026-07-15T00:00:00.000Z"),
      membershipState: "PAUSADA",
      pausedRemainingDays: 30,
    });
    expect(result.unusedMinor).toBe(3_000);
    expect(result.method).toBe("DIAS_SERVICIO_PAUSA");
  });

  test("separa crédito aplicado, diferencia y sobrante al cambiar plan", () => {
    expect(calculateOffboardingFinancialDestination({
      type: "CAMBIO_PLAN",
      unusedMinor: 20_000,
      destinationPriceMinor: 30_000,
    })).toEqual({
      creditAppliedMinor: 20_000,
      amountDueMinor: 10_000,
      remainingCreditMinor: 0,
      refundMinor: 0,
      state: "APLICADA",
    });
    expect(calculateOffboardingFinancialDestination({
      type: "CAMBIO_PLAN",
      unusedMinor: 35_000,
      destinationPriceMinor: 30_000,
    }).remainingCreditMinor).toBe(5_000);
  });

  test("un reembolso queda pendiente de tesorería", () => {
    const result = calculateOffboardingFinancialDestination({
      type: "REEMBOLSO_PENDIENTE",
      unusedMinor: 12_345,
    });
    expect(result.state).toBe("PENDIENTE_TESORERIA");
    expect(result.refundMinor).toBe(12_345);
  });
});
