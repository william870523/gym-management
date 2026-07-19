import { describe, expect, test } from "bun:test";
import {
  assignmentStateForMembership,
  assertOffboardingExecutionReady,
  deriveOffboardingDraftState,
  isTransferableFutureInstallment,
  splitCommissionInstallmentAtDate,
  normalizeOffboardingDecision,
  normalizeOffboardingEffectiveDate,
  normalizeOffboardingReason,
} from "./trainer-offboarding-policy";

const today = new Date("2026-07-14T00:00:00.000Z");

describe("trainer offboarding policy", () => {
  test("keeps contract dates at canonical UTC midnight", () => {
    expect(normalizeOffboardingEffectiveDate("2026-07-20", today).toISOString())
      .toBe("2026-07-20T00:00:00.000Z");
    expect(() => normalizeOffboardingEffectiveDate("2026-07-13", today)).toThrow();
  });

  test("requires a useful case reason", () => {
    expect(normalizeOffboardingReason("  Cambio de ciudad  ")).toBe("Cambio de ciudad");
    expect(() => normalizeOffboardingReason("sale")).toThrow();
  });

  test("reassignment requires a different destination", () => {
    expect(normalizeOffboardingDecision({
      tipo: "REASIGNAR",
      id_entrenador_destino: "trainer-2",
    }, "trainer-1").targetTrainerId).toBe("trainer-2");
    expect(() => normalizeOffboardingDecision({
      tipo: "REASIGNAR",
      id_entrenador_destino: "trainer-1",
    }, "trainer-1")).toThrow();
  });

  test("financial adjustment requires an explanation", () => {
    expect(() => normalizeOffboardingDecision({
      tipo: "AJUSTAR_CANCELAR",
      motivo: "no",
    }, "trainer-1")).toThrow();
  });

  test("draft is ready only after every membership has a decision", () => {
    expect(deriveOffboardingDraftState(["REASIGNAR", "PENDIENTE"]))
      .toEqual({ pending: 1, state: "BORRADOR" });
    expect(deriveOffboardingDraftState(["REASIGNAR", "SIN_ENTRENADOR"]))
      .toEqual({ pending: 0, state: "LISTO_PARA_REVISION" });
  });

  test("execution waits for the effective business day and financial review", () => {
    expect(() => assertOffboardingExecutionReady({
      state: "LISTO_PARA_REVISION",
      effectiveDate: new Date("2026-07-15T00:00:00.000Z"),
      businessToday: today,
      decisions: ["REASIGNAR"],
    })).toThrow();
    expect(() => assertOffboardingExecutionReady({
      state: "LISTO_PARA_REVISION",
      effectiveDate: new Date("2026-07-13T00:00:00.000Z"),
      businessToday: today,
      decisions: ["REASIGNAR"],
    })).toThrow();
    expect(() => assertOffboardingExecutionReady({
      state: "LISTO_PARA_REVISION",
      effectiveDate: today,
      businessToday: today,
      decisions: ["AJUSTAR_CANCELAR"],
    })).toThrow();
    expect(() => assertOffboardingExecutionReady({
      state: "LISTO_PARA_REVISION",
      effectiveDate: today,
      businessToday: today,
      decisions: ["REASIGNAR", "SIN_ENTRENADOR"],
    })).not.toThrow();
  });

  test("derives assignment state without making expired contracts active", () => {
    expect(assignmentStateForMembership("PENDIENTE_PAGO")).toBe("PENDIENTE");
    expect(assignmentStateForMembership("PAUSADA")).toBe("ACTIVA");
    expect(() => assignmentStateForMembership("VENCIDA")).toThrow();
  });

  test("only untouched future installments can transfer automatically", () => {
    expect(isTransferableFutureInstallment({
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      effectiveDate: today,
      state: "PENDIENTE",
    })).toBe(true);
    expect(isTransferableFutureInstallment({
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      effectiveDate: today,
      state: "PENDIENTE",
    })).toBe(false);
    expect(isTransferableFutureInstallment({
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      effectiveDate: today,
      state: "PARCIAL",
    })).toBe(false);
  });

  test("splits a daily accrual without losing cents", () => {
    expect(splitCommissionInstallmentAtDate({
      amountMinor: 10001,
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-11T00:00:00.000Z"),
      effectiveDate: new Date("2026-07-04T00:00:00.000Z"),
    })).toEqual({ earnedMinor: 3000, futureMinor: 7001 });
  });
});
