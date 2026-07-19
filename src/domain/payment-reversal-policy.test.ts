import { describe, expect, test } from "bun:test";
import {
  hasPaidCommission,
  normalizeReversalReason,
  resolveMembershipAfterReversal,
} from "./payment-reversal-policy";

describe("payment reversal policy", () => {
  test("normaliza motivo, detecta liquidaciones y revierte cobertura", () => {
    expect(normalizeReversalReason("  cobro   duplicado ")).toBe("cobro duplicado");
    expect(hasPaidCommission({
      accrualStates: ["PENDIENTE"],
      paidInstallmentCounts: [1],
      installmentStates: ["PENDIENTE"],
    })).toBe(true);
    expect(resolveMembershipAfterReversal({
      contractedAmount: 100,
      remainingPaidAmount: 0,
      currentState: "ACTIVA",
      currentActivatedAt: new Date("2026-07-01T00:00:00.000Z"),
    }).state).toBe("PENDIENTE_PAGO");
  });
});
