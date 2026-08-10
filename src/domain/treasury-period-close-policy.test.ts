import { describe, expect, test } from "bun:test";
import {
  TreasuryPeriodClosePolicyError,
  computePeriodMetrics,
  computeSigningBlockers,
  normalizePeriodRange,
  presetSemana,
} from "./treasury-period-close-policy";

const normalize = (overrides: Record<string, unknown> = {}) => normalizePeriodRange({ desde: "2026-07-06", hasta: "2026-07-12", tipo: "SEMANAL", fechaActualNegocio: "2026-08-01", ...overrides });
describe("R5.7 política de cierre por período remota", () => {
  test("normaliza fin exclusivo y preset semanal", () => {
    expect(normalize().fecha_fin_exclusiva.toISOString()).toBe("2026-07-13T00:00:00.000Z");
    expect(presetSemana("2026-07-09")).toEqual({ desde: "2026-07-06", hasta: "2026-07-12", tipo: "SEMANAL" });
  });
  test("rechaza un mes natural como personalizado", () => {
    try { normalize({ desde: "2026-07-01", hasta: "2026-07-31", tipo: "PERSONALIZADO" }); throw new Error("debió fallar"); }
    catch (error) { expect(error).toBeInstanceOf(TreasuryPeriodClosePolicyError); expect((error as TreasuryPeriodClosePolicyError).code).toBe("USE_MENSUAL"); }
  });
  test("separa monedas y conserva histórico sin actor", () => {
    const rows = [{ movimiento_id: "m1", moneda_id: "USD", cuenta_id: "u1", fecha_negocio: "2026-07-07", direccion: "ENTRADA" as const, monto: "20", origen_tipo: "PAGO_CLIENTE", origen_id: "p2", pago_cliente_id: "p2", cliente_id: "cli2", cobrado_por_user_id: null }];
    expect(computePeriodMetrics(rows, [])).toEqual([expect.objectContaining({ moneda_id: "USD", cobro_bruto: "20.00", sin_atribuir_importe: "20.00" })]);
  });
  test("mantiene los diez bloqueadores", () => {
    expect(computeSigningBlockers({ CUENTA_DIA_SIN_CIERRE: 1 })).toEqual([{ codigo: "CUENTA_DIA_SIN_CIERRE", cantidad: 1 }]);
  });
});
