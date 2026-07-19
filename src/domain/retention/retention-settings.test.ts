import { describe, expect, test } from "bun:test";
import {
  resolveRetentionSettings,
  RetentionSettingsValidationError,
  validateRetentionSettings,
} from "./retention-settings";

describe("remote retention settings", () => {
  test("la sede prevalece sobre el valor global", () => {
    const settings = resolveRetentionSettings([
      { clave: "RETENCION_GRACIA_DIAS", valor: "9", gym_id: "GLOBAL" },
      { clave: "RETENCION_GRACIA_DIAS", valor: "4", gym_id: "gym-1" },
      { clave: "RETENCION_HORIZONTE_DIAS", valor: "21", gym_id: "GLOBAL" },
    ], "gym-1");
    expect(settings.grace).toEqual({ value: 4, source: "GYM" });
    expect(settings.horizon).toEqual({ value: 21, source: "GLOBAL" });
  });

  test("un valor inválido vuelve al contrato predeterminado", () => {
    const settings = resolveRetentionSettings([
      { clave: "RETENCION_GRACIA_DIAS", valor: "61", gym_id: "gym-1" },
      { clave: "RETENCION_HORIZONTE_DIAS", valor: "x", gym_id: "gym-1" },
    ], "gym-1");
    expect(settings.grace).toEqual({ value: 5, source: "DEFAULT" });
    expect(settings.horizon).toEqual({ value: 7, source: "DEFAULT" });
  });

  test("exige enteros dentro de límites operativos", () => {
    expect(validateRetentionSettings(0, 90)).toEqual({
      graceDays: 0,
      horizonDays: 90,
    });
    expect(() => validateRetentionSettings(5.5, 7)).toThrow(
      RetentionSettingsValidationError,
    );
    expect(() => validateRetentionSettings(61, 7)).toThrow(
      "grace_days debe estar entre 0 y 60",
    );
  });
});
