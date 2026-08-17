/**
 * Entidades de SEDE que viajan por sincronización.
 *
 * **`roles` y `permissions` NO están aquí, y es deliberado.** El
 * ADR-roles-multitenant (02-08-2026, opción A) decidió que son catálogo del
 * **producto**, no dato de gimnasio: se versionan con el software y se siembran
 * con `migrate:roles-global`, que produce la misma huella en las dos bases.
 *
 * Añadirlos «por simetría» con el resto de catálogos reabriría la contradicción
 * que ese ADR cerró: un rol con `gym_id` no da aislamiento —lo da la relación
 * usuario↔gimnasio— y sí crea un frente de sincronización que nadie necesita.
 * Hay una prueba que falla si alguien los añade.
 */
export const PARITY_SYNC_TARGET_DEFINITIONS = {
  usuario_sede: { delegateKey: "usuarioSede", pk: "usuario_sede_id" },
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
  tesoreria_cierre_periodo: {
    delegateKey: "tesoreriaCierrePeriodo",
    pk: "cierre_periodo_id",
  },
  cliente_expediente_documento: {
    delegateKey: "clienteExpedienteDocumento",
    pk: "documento_id",
  },
  tipo_cambio_recargo: {
    delegateKey: "tipoCambioRecargo",
    pk: "tipo_cambio_recargo_id",
  },
  cliente_acceso_multisede: {
    delegateKey: "clienteAccesoMultisede",
    pk: "cliente_acceso_multisede_id",
  },
  cliente_visitante: { delegateKey: "clienteVisitante", pk: "ci" },
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
  // M4a: el precio del plus multi-sede es catálogo de la cadena. Sin `gym_id`
  // en el esquema, igual que sus vecinos de esta lista.
  "acceso_multisede_precio",
]);

/**
 * Alcance global **con dueño propio**: el evento llega a todas las sedes, pero
 * el payload **conserva su `gym_id`** en vez de perderlo o de recibir el de
 * quien lo aplica.
 *
 * Es un tercer caso, y hasta M4a no estaba declarado en ninguna parte: `user`
 * ya se comportaba así —la cuenta del Dueño se emite con `gym_id: null` y
 * conserva su sede principal— pero por un apaño en el receptor, no por una
 * regla.
 *
 * `cliente_acceso_multisede` lo necesita de verdad: la marca tiene que llegar a
 * **todas** las sedes para que la visitada sepa que puede dejar entrar
 * (§9-bis), y a la vez el socio **sigue siendo de su sede**. Si el payload
 * perdiera el `gym_id` nadie sabría de quién es el ingreso; si recibiera el de
 * la sede que aplica el evento, cada instalación se apropiaría del socio al
 * sincronizar —y el cobro cruzado de M4b acabaría atribuido a la sede
 * equivocada, que es el riesgo más caro que nombra §7.10—.
 */
export const GLOBAL_REACH_SYNC_ENTITIES = new Set<string>([
  "cliente_acceso_multisede",
  // La copia de solo lectura del visitante lleva su sede en
  // `gym_id_origen`, un nombre distinto a propósito para que ningún camino
  // genérico la confunda con «la sede de esta fila» y se la reescriba.
  "cliente_visitante",
]);

/**
 * Entidades sincronizadas que **no tienen columna `gym_id`** y cuya pertenencia
 * se comprueba por otro campo.
 *
 * Existe para que el aserto genérico de pertenencia no le pida `gym_id` a una
 * tabla que no lo declara: Prisma rechazaría el `select` y, por el orden
 * estricto de la cola, el fallo se llevaría por delante todos los eventos
 * siguientes. Es el mismo tipo de avería que costó dos días de descargas
 * paradas con `is_deleted` en `gym` y `device`.
 */
export const ENTIDADES_SIN_COLUMNA_GYM_ID = new Set<string>([
  "cliente_visitante",
]);

/**
 * Campos que la ficha de socio publica al LEERLA y que **no son columnas de
 * `cliente`**: la membresía vigente proyectada sobre el socio
 * (docs/DEMO_MEMBERSHIP_VIGENCIA.md).
 *
 * Viajaban dentro de los eventos `cliente/UPDATE` que emite la web, porque el
 * caso de uso reenviaba tal cual lo que devolvía `findById`. Prisma los rechaza
 * con «Unknown argument `membresia_id`» y el evento terminaba en cuarentena: un
 * socio editado en la web no llegaba nunca al escritorio.
 *
 * Se quitan en los DOS extremos a propósito. En el emisor, para que no vuelvan
 * a salir. En el receptor, porque los eventos ya emitidos tienen su payload
 * congelado y sin esto se quedarían en cuarentena para siempre, por mucho que
 * se corrija el emisor.
 *
 * Solo se quitan estos nombres, que están declarados aquí. Cualquier otro campo
 * desconocido sigue reventando a la vista: perder un campo en silencio entre
 * capas es exactamente el defecto que esta lista existe para no repetir.
 */
export const CLIENTE_PROYECCIONES_NO_PERSISTIDAS = [
  "membresia_id",
  "membresia_estado",
  "membresia_vigencia",
  "membresia_dias_desde_vencimiento",
  "membresia_cubre_hoy",
  "membresia_precio",
  "membresia_importe_pagado",
  "membresia_saldo_pendiente",
] as const;

/** Devuelve una copia del payload sin las proyecciones de lectura. */
export function quitarProyeccionesDeCliente<T extends Record<string, unknown>>(
  payload: T,
): T {
  const limpio = { ...payload };
  for (const campo of CLIENTE_PROYECCIONES_NO_PERSISTIDAS) {
    delete (limpio as Record<string, unknown>)[campo];
  }
  return limpio;
}

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

/**
 * La versión del emisor es autoritativa también en DELETE. Los eventos
 * antiguos que no la incluyen conservan el comportamiento legacy, pero una
 * versión presente debe ser un entero positivo para evitar divergencias
 * silenciosas entre SQLite y MariaDB.
 */
export function optionalSyncVersion(
  payload: Record<string, unknown>,
  entity: string,
): number | undefined {
  const rawVersion = payload.version;
  if (rawVersion === undefined || rawVersion === null) return undefined;

  const version = Number(rawVersion);
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error(
      `Versión de sync inválida para ${entity}: ${String(rawVersion)}.`,
    );
  }
  return version;
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

  if (GLOBAL_REACH_SYNC_ENTITIES.has(input.entity)) {
    // El `gym_id` se conserva: es la sede DUEÑA del socio, no la del emisor.
    // Que el emisor no pueda mentir lo garantiza la validación previa, que
    // exige que coincida con la sede del dispositivo mientras el cobro por
    // cuenta ajena (M4b) no exista.
    record.source_device = input.deviceId;
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
