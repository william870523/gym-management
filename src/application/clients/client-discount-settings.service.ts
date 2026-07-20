import { randomUUID } from "crypto";
import { trustedClock } from "../../config/trusted-clock";
import {
  CLIENT_OLD_DISCOUNT_KEY,
  CLIENT_OLD_DISCOUNT_LIMITS,
  ClientDiscountSettingsValidationError,
  resolveClientDiscountPct,
  validateClientDiscountPct,
} from "../../domain/clients/client-discount-settings";
import { prisma } from "../../infrastructure/db/prismaClient";

const DEFINITION = {
  key: CLIENT_OLD_DISCOUNT_KEY,
  id: (gymId: string) => `config-client-old-discount-${gymId}`,
  description:
    "Porcentaje de descuento aplicado a cliente VIEJO cuando el plan no define precio excepción",
} as const;

export class ClientDiscountSettingsError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 = 400,
  ) {
    super(message);
  }
}

export class ClientDiscountSettingsService {
  async get(gymId: string) {
    const rows = await this.rows(gymId);
    return present(gymId, rows, []);
  }

  async update(gymId: string, pct: unknown) {
    let normalized: string;
    try {
      normalized = validateClientDiscountPct(pct);
    } catch (error) {
      if (error instanceof ClientDiscountSettingsValidationError) {
        throw new ClientDiscountSettingsError(error.message);
      }
      throw error;
    }
    const nowUtc = trustedClock.nowUtc();
    const changed = await prisma.$transaction(async (tx) => {
      const existing = await tx.configuracionSistema.findUnique({
        where: { clave_gym_id: { clave: DEFINITION.key, gym_id: gymId } },
      });
      if (existing && !existing.is_deleted && existing.valor === normalized) {
        return [] as string[];
      }
      const config = await tx.configuracionSistema.upsert({
        where: { clave_gym_id: { clave: DEFINITION.key, gym_id: gymId } },
        create: {
          configuracion_id: DEFINITION.id(gymId),
          clave: DEFINITION.key,
          valor: normalized,
          descripcion: DEFINITION.description,
          gym_id: gymId,
          created_at: nowUtc,
          updated_at: nowUtc,
          version: 1,
        },
        update: {
          valor: normalized,
          descripcion: DEFINITION.description,
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
      return [DEFINITION.key];
    });
    return present(gymId, await this.rows(gymId), changed);
  }

  /** Lee el % efectivo para un gimnasio (gym → GLOBAL → DEFAULT). */
  async resolvePct(gymId: string): Promise<string> {
    const rows = await this.rows(gymId);
    return resolveClientDiscountPct(rows, gymId).value;
  }

  private rows(gymId: string) {
    return prisma.configuracionSistema.findMany({
      where: {
        clave: CLIENT_OLD_DISCOUNT_KEY,
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

function present(
  gymId: string,
  rows: Array<{
    clave: string;
    valor: string;
    gym_id: string;
    updated_at: Date;
  }>,
  changedKeys: string[],
) {
  const resolved = resolveClientDiscountPct(rows, gymId);
  const latest = rows.reduce<Date | null>(
    (result, row) =>
      result === null || row.updated_at > result ? row.updated_at : result,
    null,
  );
  return {
    gym_id: gymId,
    cliente_viejo_pct: resolved.value,
    source: resolved.source,
    limits: { min: CLIENT_OLD_DISCOUNT_LIMITS.min, max: CLIENT_OLD_DISCOUNT_LIMITS.max },
    changed_keys: changedKeys,
    updated_at_utc: latest?.toISOString() ?? null,
  };
}
