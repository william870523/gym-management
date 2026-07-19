import { describe, expect, test } from "bun:test";
import {
  normalizeTreasuryCloseApprovalPolicy,
  normalizeTreasuryManualIntent,
  normalizeTreasuryReconciliationIntent,
  parseTreasuryBusinessDate,
  parseTreasuryMonth,
  treasuryCloseAmounts,
  treasuryCloseNeedsApproval,
  treasuryCloseToleranceMinor,
  treasuryRoleAllowed,
  treasuryMoneyToMinor,
} from "./treasury-ledger-policy";

describe("treasury ledger policy", () => {
  test("normaliza motivo y evidencia de conciliación", () => {
    expect(
      normalizeTreasuryReconciliationIntent({
        closeId: "close-demo-123",
        reason: "  Movimiento recibido después del cierre  ",
        evidence: "  Ticket SYNC-77  ",
      }),
    ).toEqual({
      closeId: "close-demo-123",
      reason: "Movimiento recibido después del cierre",
      evidence: "Ticket SYNC-77",
    });
  });

  test("calcula saldo esperado y diferencia en centavos exactos", () => {
    const result = treasuryCloseAmounts({
      opening: "100.00",
      counted: "174.49",
      entriesMinor: 10_000n,
      exitsMinor: 2_550n,
    });
    expect(result.expected).toBe("174.50");
    expect(result.difference).toBe("-0.01");
  });

  test("resuelve tolerancias por moneda y exige aprobación fuera del margen", () => {
    const policy = normalizeTreasuryCloseApprovalPolicy({
      default_tolerance: "1",
      currency_tolerances: { cup: "10.50" },
      submitter_roles: ["Recepción"],
      approver_roles: ["Administración"],
    });
    expect(treasuryCloseToleranceMinor(policy, "cup")).toBe(1050n);
    expect(treasuryCloseToleranceMinor(policy, "eur")).toBe(100n);
    expect(treasuryCloseNeedsApproval(-1050n, 1050n)).toBe(false);
    expect(treasuryCloseNeedsApproval(-1051n, 1050n)).toBe(true);
    expect(treasuryRoleAllowed("RECEPCION", policy.submitterRoles)).toBe(true);
    expect(treasuryRoleAllowed("admin", policy.approverRoles)).toBe(false);
  });

  test("rechaza más de dos decimales", () => {
    expect(() => treasuryMoneyToMinor("1.001")).toThrow();
  });

  test("la fecha contractual conserva el mismo día UTC", () => {
    expect(parseTreasuryBusinessDate("2026-07-16").toISOString()).toBe(
      "2026-07-16T00:00:00.000Z",
    );
  });

  test("el mes contable produce límites UTC exclusivos", () => {
    const period = parseTreasuryMonth("2026-12");
    expect(period.month).toBe("2026-12");
    expect(period.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(period.endExclusive.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(() => parseTreasuryMonth("2026-13")).toThrow("no es válido");
  });

  test("normaliza un gasto manual con evidencia y centavos exactos", () => {
    expect(
      normalizeTreasuryManualIntent({
        kind: "gasto",
        concept: "  Compra   de agua ",
        evidence: "Factura A-17",
        amount: "125.50",
        originAccountId: "caja",
        originPaymentTypeId: "efectivo",
      }),
    ).toMatchObject({
      kind: "GASTO",
      concept: "Compra de agua",
      evidence: "Factura A-17",
      amount: "125.50",
      amountMinor: 12_550n,
    });
  });

  test("una transferencia exige contrapartida distinta", () => {
    expect(() =>
      normalizeTreasuryManualIntent({
        kind: "TRANSFERENCIA",
        concept: "Mover efectivo",
        evidence: "Arqueo 22",
        amount: "100",
        originAccountId: "caja",
        originPaymentTypeId: "efectivo",
        destinationAccountId: "caja",
        destinationPaymentTypeId: "efectivo",
      }),
    ).toThrow("dos cuentas diferentes");
  });
});
