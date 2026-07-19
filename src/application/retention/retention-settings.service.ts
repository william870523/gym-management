import { randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  resolveRetentionSettings,
  RETENTION_GRACE_KEY,
  RETENTION_GRACE_LIMITS,
  RETENTION_HORIZON_KEY,
  RETENTION_HORIZON_LIMITS,
  RetentionSettingsValidationError,
  validateRetentionSettings,
} from "../../domain/retention/retention-settings";
import { prisma } from "../../infrastructure/db/prismaClient";

const definitions = [
  {
    key: RETENTION_GRACE_KEY,
    id: (gymId: string) => `config-retention-grace-${gymId}`,
    description:
      "Días de calendario posteriores al vencimiento en los que aún se considera renovación en gracia",
  },
  {
    key: RETENTION_HORIZON_KEY,
    id: (gymId: string) => `config-retention-horizon-${gymId}`,
    description:
      "Días futuros incluidos en la cola operativa de próximos vencimientos",
  },
] as const;

export class RetentionSettingsError extends Error {
  constructor(message: string, public readonly status: 400 | 403 = 400) {
    super(message);
  }
}

export class RetentionSettingsService {
  async get(gymId: string) {
    const rows = await this.rows(gymId);
    return presentSettings(gymId, rows, []);
  }

  async update(
    gymId: string,
    input: { graceDays: unknown; horizonDays: unknown },
  ) {
    let values;
    try {
      values = validateRetentionSettings(input.graceDays, input.horizonDays);
    } catch (error) {
      if (error instanceof RetentionSettingsValidationError) {
        throw new RetentionSettingsError(error.message);
      }
      throw error;
    }
    const nowUtc = trustedClock.nowUtc();
    const valueByKey = new Map([
      [RETENTION_GRACE_KEY, values.graceDays],
      [RETENTION_HORIZON_KEY, values.horizonDays],
    ]);

    const changed = await prisma.$transaction(async (tx) => {
      const changedKeys: string[] = [];
      for (const definition of definitions) {
        const value = String(valueByKey.get(definition.key));
        const existing = await tx.configuracionSistema.findUnique({
          where: { clave_gym_id: { clave: definition.key, gym_id: gymId } },
        });
        if (existing && !existing.is_deleted && existing.valor === value) {
          continue;
        }
        const config = await tx.configuracionSistema.upsert({
          where: { clave_gym_id: { clave: definition.key, gym_id: gymId } },
          create: {
            configuracion_id: definition.id(gymId),
            clave: definition.key,
            valor: value,
            descripcion: definition.description,
            gym_id: gymId,
            created_at: nowUtc,
            updated_at: nowUtc,
            version: 1,
          },
          update: {
            valor: value,
            descripcion: definition.description,
            updated_at: nowUtc,
            version: { increment: 1 },
            is_deleted: false,
            deleted_at: null,
          },
        });
        await tx.syncLog.create({
          data: {
            event_id: randomUUID(),
            entidad: "configuracion_sistema",
            operacion: existing ? "UPDATE" : "INSERT",
            entidad_id: config.configuracion_id,
            gym_id: gymId,
            device_id: "WEB_ADMIN",
            payload_json: JSON.stringify(config),
            created_at: nowUtc,
          },
        });
        changedKeys.push(definition.key);
      }
      return changedKeys;
    });

    return presentSettings(gymId, await this.rows(gymId), changed);
  }

  private rows(gymId: string) {
    return prisma.configuracionSistema.findMany({
      where: {
        clave: { in: [RETENTION_GRACE_KEY, RETENTION_HORIZON_KEY] },
        gym_id: { in: [gymId, "GLOBAL"] },
        is_deleted: false,
      },
      select: {
        clave: true,
        valor: true,
        gym_id: true,
        updated_at: true,
      },
    });
  }
}

function presentSettings(
  gymId: string,
  rows: Array<{
    clave: string;
    valor: string;
    gym_id: string;
    updated_at: Date;
  }>,
  changedKeys: string[],
) {
  const settings = resolveRetentionSettings(rows, gymId);
  const latest = rows.reduce<Date | null>(
    (result, row) => result === null || row.updated_at > result
      ? row.updated_at
      : result,
    null,
  );
  return {
    gym_id: gymId,
    grace_days: settings.grace.value,
    horizon_days: settings.horizon.value,
    exit_begins_day: settings.grace.value + 1,
    sources: {
      grace: settings.grace.source,
      horizon: settings.horizon.source,
    },
    limits: {
      grace: RETENTION_GRACE_LIMITS,
      horizon: RETENTION_HORIZON_LIMITS,
    },
    changed_keys: changedKeys,
    updated_at_utc: latest?.toISOString() ?? null,
  };
}
