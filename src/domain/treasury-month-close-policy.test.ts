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

  /**
   * Unidad 10 · ADR-roles-multitenant — recepción no firma dinero.
   *
   * La prueba de arriba cubría `accounting` y `administrador`, pero **no
   * `reception`**, que es precisamente el rol que existe de verdad en la base y
   * el que el manual nombra. Un cierre firmado por quien no debe no da error:
   * queda firmado, y el nombre del firmante es lo que audita el mes.
   */
  test("recepción no puede firmar ni reabrir un cierre", () => {
    for (const rol of ["reception", "recepcion", "recepcionista", "operador"]) {
      expect(canCloseTreasuryMonth(rol)).toBeFalse();
      expect(canReopenTreasuryMonth(rol)).toBeFalse();
    }
  });

  test("administración sí cierra y sí reabre", () => {
    for (const rol of ["admin", "administrador"]) {
      expect(canCloseTreasuryMonth(rol)).toBeTrue();
      expect(canReopenTreasuryMonth(rol)).toBeTrue();
    }
  });

  test("un rol desconocido o ausente no autoriza nada", () => {
    // Fallar abierto aquí sería catastrófico: cualquier token sin rol podría
    // firmar el mes.
    for (const rol of [undefined, null, "", "  ", "device", "inventado"]) {
      expect(canCloseTreasuryMonth(rol)).toBeFalse();
      expect(canReopenTreasuryMonth(rol)).toBeFalse();
    }
  });
});
