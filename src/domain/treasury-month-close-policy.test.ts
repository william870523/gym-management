import { describe, expect, test } from "bun:test";
import {
  assertCompletedMonth,
  assertMonthlyCloseReady,
  canCloseTreasuryMonth,
  canReopenTreasuryMonth,
  monthlyCloseBlockers,
  normalizeMonthlyCloseReason,
} from "./treasury-month-close-policy";

describe("remote treasury month close policy parity", () => {
  test("mes, bloqueos y permisos conservan el contrato local", () => {
    expect(assertCompletedMonth("2026-06", new Date("2026-07-01T00:00:00.000Z")).month)
      .toBe("2026-06");
    expect(() => assertCompletedMonth("2026-07", new Date("2026-07-17T00:00:00.000Z")))
      .toThrow("ha terminado");
    const blockers = monthlyCloseBlockers([{
      moneda_codigo: "EUR",
      jornadas_por_cerrar: 0,
      solicitudes_pendientes: 0,
      movimientos_tardios_pendientes: 1,
      revisiones_pendientes: 0,
      cuentas_sin_cierre: 0,
      movimientos_sin_cuenta: 0,
    }]);
    expect(() => assertMonthlyCloseReady(blockers)).toThrow("EUR: 1");
    expect(canCloseTreasuryMonth("accounting")).toBeTrue();
    expect(canReopenTreasuryMonth("accounting")).toBeFalse();
    expect(canReopenTreasuryMonth("administrador")).toBeTrue();
    expect(normalizeMonthlyCloseReason("  Cierre revisado por gerencia ", "cerrar"))
      .toBe("Cierre revisado por gerencia");
  });
});
