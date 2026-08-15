import { describe, expect, test } from "bun:test";
import {
  effectiveSurchargeVersion,
  resolveScopedSurcharges,
  surchargeScopeId,
} from "./rate-surcharge-scope.service";

const row = (gymId: string, paymentTypeId: string, percentage: string, version = 1) => ({
  tipo_cambio_recargo_id: surchargeScopeId("rate", paymentTypeId, gymId),
  tipo_cambio_id: "rate",
  tipo_pago_id: paymentTypeId,
  gym_id: gymId,
  porcentaje: percentage,
  source_device: "test",
  is_deleted: false,
  created_at: new Date("2026-08-15T00:00:00Z"),
  updated_at: new Date("2026-08-15T00:00:00Z"),
  version,
  deleted_at: null,
});

describe("M3 recargo global con excepción por sede", () => {
  test("la sede gana por método y conserva fallback global en los demás", () => {
    const result = resolveScopedSurcharges({
      gymId: "gym-a",
      legacyJson: '{"cash":"2.00"}',
      rows: [row("GLOBAL", "transfer", "5.00", 2), row("gym-a", "transfer", "8.00", 3)],
    });
    expect(result.effective).toEqual({ cash: "2.00", transfer: "8.00" });
    expect(result.global).toEqual({ cash: "2.00", transfer: "5.00" });
    expect(result.site).toEqual({ transfer: "8.00" });
    expect(result.sources).toEqual({ cash: "GLOBAL", transfer: "SEDE" });
    expect(result.source).toBe("MIXTO");
    expect(effectiveSurchargeVersion(7, result.versions.transfer)).toBe(7000003);
  });

  test("cero en sede desactiva explícitamente el recargo global", () => {
    const result = resolveScopedSurcharges({
      gymId: "gym-a",
      rows: [row("GLOBAL", "transfer", "5.00"), row("gym-a", "transfer", "0.00", 4)],
    });
    expect(result.effective).toEqual({});
    expect(result.site).toEqual({ transfer: "0.00" });
    expect(result.sources.transfer).toBe("SEDE");
  });

  test("la identidad incluye tasa, método y ámbito", () => {
    expect(surchargeScopeId("rate", "transfer", "GLOBAL"))
      .not.toBe(surchargeScopeId("rate", "transfer", "gym-a"));
    expect(surchargeScopeId("rate", "transfer", "gym-a"))
      .toBe(surchargeScopeId("rate", "transfer", "gym-a"));
  });
});
