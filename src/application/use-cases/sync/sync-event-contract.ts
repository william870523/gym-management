export const PARITY_SYNC_TARGET_DEFINITIONS = {
  gasto_categoria: { delegateKey: "gastoCategoria", pk: "categoria_id" },
  gasto_proveedor: { delegateKey: "gastoProveedor", pk: "proveedor_id" },
  gasto_gobernado: { delegateKey: "gastoGobernado", pk: "gasto_id" },
  gasto_gobernado_aplicacion: {
    delegateKey: "gastoGobernadoAplicacion",
    pk: "aplicacion_id",
  },
  gasto_recurrente: { delegateKey: "gastoRecurrente", pk: "recurrente_id" },
  plan_cuota_esquema: { delegateKey: "planCuotaEsquema", pk: "esquema_id" },
  membresia_cuota: {
    delegateKey: "membresiaCuota",
    pk: "cuota_instancia_id",
  },
} as const;

export const PARITY_SYNC_ENTITIES = new Set<string>(
  Object.keys(PARITY_SYNC_TARGET_DEFINITIONS),
);

export const GLOBAL_SYNC_ENTITIES = new Set<string>([
  "moneda",
  "monedas",
  "nacionalidad",
  "nacionalidades",
  "tipo_pago",
  "tipo_cambio",
  "referencia",
]);

export type SyncOperation = "INSERT" | "UPDATE" | "DELETE";

type SyncTarget = {
  delegate: unknown;
  pk: string;
};

function isMissingIdentifier(value: unknown) {
  return value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0);
}

export function requireSyncOperation(
  value: unknown,
  entity: string,
): SyncOperation {
  if (value !== "INSERT" && value !== "UPDATE" && value !== "DELETE") {
    throw new Error(
      `Operación de sync no soportada para ${entity}: ${String(value ?? "ausente")}.`,
    );
  }
  return value;
}

export function requireSyncEntityId(value: unknown, entity: string): string {
  if (isMissingIdentifier(value)) {
    throw new Error(`Falta entidad_id para el evento de sync ${entity}.`);
  }
  return String(value);
}

export function requireMappedSyncTarget<T extends SyncTarget>(
  mapping: Record<string, T>,
  entity: string,
): T {
  const target = mapping[entity];
  if (!target) {
    throw new Error(`Entidad Prisma de sync no soportada: ${entity}.`);
  }
  if (!target.pk || !target.delegate) {
    throw new Error(`El destino Prisma de ${entity} está ausente o incompleto.`);
  }
  return target;
}

export function requireSyncPrimaryKey(input: {
  entity: string;
  pk: string;
  entityId: unknown;
  payload: Record<string, unknown>;
}) {
  const payloadId = input.payload[input.pk];
  if (
    !isMissingIdentifier(input.entityId) &&
    !isMissingIdentifier(payloadId) &&
    String(input.entityId) !== String(payloadId)
  ) {
    throw new Error(
      `PK contradictoria para ${input.entity}: entidad_id=${String(input.entityId)} ` +
        `y payload.${input.pk}=${String(payloadId)}.`,
    );
  }

  const primaryKey = isMissingIdentifier(input.entityId)
    ? payloadId
    : input.entityId;
  if (isMissingIdentifier(primaryKey)) {
    throw new Error(
      `Falta la PK ${input.pk} para la entidad de sync ${input.entity}.`,
    );
  }
  return primaryKey;
}

export function assertSyncPrimaryKeyOwnership(input: {
  entity: string;
  primaryKey: unknown;
  gymId: string;
  existingRecord: { gym_id: string | null } | null;
}) {
  if (
    input.existingRecord &&
    input.existingRecord.gym_id !== input.gymId
  ) {
    throw new Error(
      `No se puede sincronizar ${input.entity} ${String(input.primaryKey)}: ` +
        "la PK ya pertenece a otro gimnasio.",
    );
  }
}

export function buildAuthoritativeGymRecord(input: {
  payload: Record<string, unknown>;
  primaryKeyField: string;
  primaryKey: unknown;
  gymId: string;
  deviceId: string;
}) {
  return {
    ...input.payload,
    [input.primaryKeyField]: input.primaryKey,
    gym_id: input.gymId,
    source_device: input.deviceId,
  };
}

export function buildAuthenticatedSyncPayload(input: {
  entity: string;
  payload: Record<string, unknown>;
  gymId: string;
  deviceId: string;
}) {
  const record: Record<string, unknown> = { ...input.payload };
  if (GLOBAL_SYNC_ENTITIES.has(input.entity) || input.entity === "gym") {
    delete record.gym_id;
    delete record.source_device;
    return record;
  }

  record.gym_id = input.gymId;
  if (input.entity === "configuracion_sistema") {
    delete record.source_device;
  } else {
    record.source_device = input.deviceId;
  }
  return record;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

function positiveMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function requiredDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validatePlanInstallmentSyncRecord(
  record: Record<string, unknown>,
) {
  if (
    !positiveInteger(record.numero_cuota) ||
    !positiveInteger(record.dias_cobertura) ||
    !positiveInteger(record.orden) ||
    Number(record.orden) !== Number(record.numero_cuota) ||
    !positiveMoney(record.importe)
  ) {
    throw new Error(
      "El esquema de cuotas sincronizado requiere número/orden coherentes, " +
        "días positivos e importe positivo.",
    );
  }
}

export function validateMembershipInstallmentSyncRecord(
  record: Record<string, unknown>,
) {
  const state = String(record.estado ?? "").trim().toUpperCase();
  const due = requiredDate(record.fecha_exigible);
  const start = requiredDate(record.fecha_cobertura_inicio);
  const end = requiredDate(record.fecha_cobertura_fin);
  const hasPaidDate = record.fecha_pagada !== null &&
    record.fecha_pagada !== undefined;
  const paid = !hasPaidDate
    ? null
    : requiredDate(record.fecha_pagada);
  if (
    !positiveInteger(record.numero_cuota) ||
    !positiveInteger(record.dias_cobertura) ||
    !positiveMoney(record.importe) ||
    !["PENDIENTE", "PAGADA", "ANTICIPADA", "ANULADA"].includes(state) ||
    !due ||
    !start ||
    !end ||
    end.getTime() <= start.getTime() ||
    ((state === "PAGADA" || state === "ANTICIPADA") && !paid) ||
    ((state === "PENDIENTE" || state === "ANULADA") && hasPaidDate)
  ) {
    throw new Error(
      "La cuota sincronizada no conserva importe, estado, fechas y cobertura coherentes.",
    );
  }
  record.estado = state;
}

const NON_DATE_SYNC_FIELDS = new Set(["periodo_pertenencia_mes"]);

export function normalizeSyncDates(payload: Record<string, unknown>) {
  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (
      !NON_DATE_SYNC_FIELDS.has(key) &&
      typeof value === "string" &&
      (key.endsWith("_at") ||
        key.endsWith("_fecha") ||
        key.includes("_fecha_") ||
        key.startsWith("fecha_") ||
        key.startsWith("periodo_")) &&
      !Number.isNaN(Date.parse(value))
    ) {
      payload[key] = new Date(value);
    }
  }
  return payload;
}
