import { describe, expect, test } from "bun:test";
import {
  assertTreasuryRefundOutput,
  normalizeTreasuryRefundAction,
  normalizeTreasuryRefundReason,
} from "./treasury-refund-policy";

describe("remote treasury refund policy parity", () => {
  test("confirmar exige cuenta, método e importe exacto", () => {
    expect(() => assertTreasuryRefundOutput({ action: "CONFIRMAR", amountMinor: 2500 })).toThrow();
    expect(() => assertTreasuryRefundOutput({
      action: "CONFIRMAR",
      amountMinor: 2500,
      accountId: "cash",
      paymentTypeId: "efectivo",
    })).not.toThrow();
  });

  test("rechazar conserva una explicación auditable", () => {
    expect(normalizeTreasuryRefundAction("RECHAZAR_ACREDITAR")).toBe("RECHAZAR_ACREDITAR");
    expect(normalizeTreasuryRefundReason("  Transferencia rechazada  ")).toBe("Transferencia rechazada");
  });
});
