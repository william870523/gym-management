import { describe, expect, test } from "bun:test";
import {
  assertSettlementApplicationCount,
  assertSettlementScope,
  installmentState,
  moneyToMinorUnits,
  normalizeFixedSettlementApplications,
  normalizeOptionalSettlementApplications,
  normalizeSettlementApplications,
  settlementIntentSignature,
} from "./trainer-settlement-policy";

describe("trainer settlement policy remote parity", () => {
  test("mantiene dinero, alcance y estados equivalentes", () => {
    expect(moneyToMinorUnits("750.00")).toBe(75_000n);
    expect(normalizeSettlementApplications([{ cuota_id: "c1", monto: "250" }]))
      .toHaveLength(1);
    expect(assertSettlementScope([
      { id_entrenador: "e1", moneda_id: "CUP" },
    ])).toEqual({ trainerId: "e1", currencyId: "CUP" });
    expect(installmentState(25_000n, 12_500n)).toBe("PARCIAL");
  });

  test("mantiene aplicaciones fijas separadas e idempotentes", () => {
    const commissions = normalizeOptionalSettlementApplications([
      { cuota_id: "c1", monto: "25" },
    ]);
    const fixed = normalizeFixedSettlementApplications([
      { obligacion_id: "f1", monto: "50" },
    ]);
    expect(assertSettlementApplicationCount(commissions, fixed)).toBe(2);
    expect(settlementIntentSignature({
      trainerId: "e1",
      currencyId: "CUP",
      accountId: "a1",
      paymentTypeId: "cash",
      applications: commissions,
      fixedApplications: fixed,
    })).toContain("#FIJO:f1:50.00");
  });
});
