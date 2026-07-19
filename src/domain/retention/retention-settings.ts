export const RETENTION_GRACE_KEY = "RETENCION_GRACIA_DIAS";
export const RETENTION_HORIZON_KEY = "RETENCION_HORIZONTE_DIAS";
export const DEFAULT_RETENTION_GRACE_DAYS = 5;
export const DEFAULT_RETENTION_HORIZON_DAYS = 7;
export const RETENTION_GRACE_LIMITS = { min: 0, max: 60 } as const;
export const RETENTION_HORIZON_LIMITS = { min: 1, max: 90 } as const;

export type RetentionSettingSource = "GYM" | "GLOBAL" | "DEFAULT";

export interface RetentionConfigurationRow {
  clave: string;
  valor: string;
  gym_id: string;
}

export interface RetentionSettingsInput {
  graceDays: number;
  horizonDays: number;
}

export class RetentionSettingsValidationError extends Error {}

export function resolveRetentionSettings(
  rows: RetentionConfigurationRow[],
  gymId: string,
) {
  return {
    grace: configuredInteger(
      rows,
      RETENTION_GRACE_KEY,
      gymId,
      DEFAULT_RETENTION_GRACE_DAYS,
      RETENTION_GRACE_LIMITS.min,
      RETENTION_GRACE_LIMITS.max,
    ),
    horizon: configuredInteger(
      rows,
      RETENTION_HORIZON_KEY,
      gymId,
      DEFAULT_RETENTION_HORIZON_DAYS,
      RETENTION_HORIZON_LIMITS.min,
      RETENTION_HORIZON_LIMITS.max,
    ),
  };
}

export function validateRetentionSettings(
  graceDays: unknown,
  horizonDays: unknown,
): RetentionSettingsInput {
  return {
    graceDays: requiredInteger(
      graceDays,
      "grace_days",
      RETENTION_GRACE_LIMITS.min,
      RETENTION_GRACE_LIMITS.max,
    ),
    horizonDays: requiredInteger(
      horizonDays,
      "horizon_days",
      RETENTION_HORIZON_LIMITS.min,
      RETENTION_HORIZON_LIMITS.max,
    ),
  };
}

function configuredInteger(
  rows: RetentionConfigurationRow[],
  key: string,
  gymId: string,
  fallback: number,
  min: number,
  max: number,
): { value: number; source: RetentionSettingSource } {
  const row = rows.find((item) => item.clave === key && item.gym_id === gymId)
    ?? rows.find((item) => item.clave === key && item.gym_id === "GLOBAL");
  if (!row) return { value: fallback, source: "DEFAULT" };
  const parsed = Number(row.valor);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { value: fallback, source: "DEFAULT" };
  }
  return { value: parsed, source: row.gym_id === gymId ? "GYM" : "GLOBAL" };
}

function requiredInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new RetentionSettingsValidationError(`${name} debe ser un entero.`);
  }
  if (value < min || value > max) {
    throw new RetentionSettingsValidationError(
      `${name} debe estar entre ${min} y ${max}.`,
    );
  }
  return value;
}
