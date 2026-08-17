import { describe, expect, it } from "bun:test";
import {
  PARITY_SYNC_ENTITIES,
  PARITY_SYNC_TARGET_DEFINITIONS,
  assertSyncPrimaryKeyOwnership,
  buildAuthenticatedSyncPayload,
  GLOBAL_REACH_SYNC_ENTITIES,
  GLOBAL_SYNC_ENTITIES,
  buildAuthoritativeGymRecord,
  normalizeSyncDates,
  optionalSyncVersion,
  requireMappedSyncTarget,
  requireSyncEntityId,
  requireSyncOperation,
  requireSyncPrimaryKey,
  validateMembershipInstallmentSyncRecord,
  validatePlanInstallmentSyncRecord,
} from "./sync-event-contract";

describe("contrato fail-closed de upload", () => {
  it("declara las trece entidades con pertenencia estricta", () => {
    expect([...PARITY_SYNC_ENTITIES]).toEqual([
      "usuario_sede",
      "gasto_categoria",
      "gasto_proveedor",
      "gasto_gobernado",
      "gasto_gobernado_aplicacion",
      "gasto_recurrente",
      "plan_cuota_esquema",
      "membresia_cuota",
      "tesoreria_cierre_periodo",
      "cliente_expediente_documento",
      "tipo_cambio_recargo",
      "cliente_acceso_multisede",
      "cliente_visitante",
    ]);
    expect(PARITY_SYNC_TARGET_DEFINITIONS.usuario_sede).toEqual({
      delegateKey: "usuarioSede",
      pk: "usuario_sede_id",
    });
    expect(PARITY_SYNC_TARGET_DEFINITIONS.membresia_cuota).toEqual({
      delegateKey: "membresiaCuota",
      pk: "cuota_instancia_id",
    });
    expect(PARITY_SYNC_TARGET_DEFINITIONS.tesoreria_cierre_periodo).toEqual({
      delegateKey: "tesoreriaCierrePeriodo",
      pk: "cierre_periodo_id",
    });
    expect(PARITY_SYNC_TARGET_DEFINITIONS.cliente_expediente_documento).toEqual({
      delegateKey: "clienteExpedienteDocumento",
      pk: "documento_id",
    });
    expect(PARITY_SYNC_TARGET_DEFINITIONS.tipo_cambio_recargo).toEqual({
      delegateKey: "tipoCambioRecargo",
      pk: "tipo_cambio_recargo_id",
    });
  });

  it("rechaza operación, entidad_id y target ausentes", () => {
    expect(() => requireSyncOperation("UPSERT", "gasto_categoria")).toThrow(
      "Operación de sync no soportada",
    );
    expect(() => requireSyncEntityId(" ", "gasto_categoria")).toThrow(
      "Falta entidad_id",
    );
    expect(() =>
      requireMappedSyncTarget(
        { gasto_categoria: { delegate: undefined, pk: "categoria_id" } },
        "gasto_categoria",
      )
    ).toThrow("destino Prisma");
    expect(() => requireMappedSyncTarget({}, "entidad_futura")).toThrow(
      "no soportada",
    );
  });

  it("rechaza una PK contradictoria", () => {
    expect(() =>
      requireSyncPrimaryKey({
        entity: "gasto_categoria",
        pk: "categoria_id",
        entityId: "cat-a",
        payload: { categoria_id: "cat-b" },
      })
    ).toThrow("PK contradictoria");
  });

  it("impide reasignar una PK perteneciente a otro gimnasio", () => {
    expect(() =>
      assertSyncPrimaryKeyOwnership({
        entity: "gasto_categoria",
        primaryKey: "cat-1",
        gymId: "gym-a",
        existingRecord: { gym_id: "gym-b" },
      })
    ).toThrow("otro gimnasio");
    expect(() =>
      assertSyncPrimaryKeyOwnership({
        entity: "gasto_categoria",
        primaryKey: "cat-1",
        gymId: "gym-a",
        existingRecord: { gym_id: "gym-a" },
      })
    ).not.toThrow();
  });

  it("impone gimnasio y dispositivo autenticados sobre el payload", () => {
    expect(buildAuthoritativeGymRecord({
      payload: {
        gasto_id: "gasto-falso",
        gym_id: "gym-atacante",
        source_device: "device-atacante",
        descripcion: "Electricidad",
      },
      primaryKeyField: "gasto_id",
      primaryKey: "gasto-real",
      gymId: "gym-autenticado",
      deviceId: "device-autenticado",
    })).toEqual({
      gasto_id: "gasto-real",
      gym_id: "gym-autenticado",
      source_device: "device-autenticado",
      descripcion: "Electricidad",
    });
  });

  it("registra en sync_log una identidad autenticada y limpia catálogos globales", () => {
    expect(buildAuthenticatedSyncPayload({
      entity: "planes_pago",
      payload: {
        gym_id: "gym-atacante",
        source_device: "device-atacante",
        codigo: "TRI",
      },
      gymId: "gym-auth",
      deviceId: "device-auth",
    })).toEqual({
      gym_id: "gym-auth",
      source_device: "device-auth",
      codigo: "TRI",
    });
    expect(buildAuthenticatedSyncPayload({
      entity: "moneda",
      payload: {
        gym_id: "gym-atacante",
        source_device: "device-atacante",
        moneda_id: "USD",
      },
      gymId: "gym-auth",
      deviceId: "device-auth",
    })).toEqual({ moneda_id: "USD" });
  });

  it("el acceso multi-sede conserva su sede dueña: ni la pierde ni recibe la del emisor", () => {
    // Las tres familias, una al lado de otra, porque la diferencia entre ellas
    // es lo que M4a añadió y lo que se olvida al leer el código por encima:
    // catálogo global pierde `gym_id`; entidad de sede recibe el del emisor;
    // alcance global con dueño propio lo CONSERVA.
    expect(buildAuthenticatedSyncPayload({
      entity: "cliente_acceso_multisede",
      payload: {
        gym_id: "gym-oeste",
        source_device: "device-atacante",
        ci: "91021020015",
      },
      gymId: "gym-oeste",
      deviceId: "device-auth",
    })).toEqual({
      gym_id: "gym-oeste",
      source_device: "device-auth",
      ci: "91021020015",
    });
    expect(GLOBAL_REACH_SYNC_ENTITIES.has("cliente_acceso_multisede")).toBe(true);
    // El precio sí es catálogo de la cadena y no lleva sede ninguna.
    expect(GLOBAL_SYNC_ENTITIES.has("acceso_multisede_precio")).toBe(true);
  });

  it("normaliza instantes sin convertir el mes contable en Date", () => {
    const result = normalizeSyncDates({
      aplicada_at: "2026-07-21T18:00:00.000Z",
      periodo_pertenencia_mes: "2026-07",
    });
    expect(result.aplicada_at).toBeInstanceOf(Date);
    expect(result.periodo_pertenencia_mes).toBe("2026-07");
  });

  it("PD-4: valida la versión autoritativa de un DELETE", () => {
    expect(optionalSyncVersion({ version: 2 }, "pago_cliente")).toBe(2);
    expect(optionalSyncVersion({}, "pago_cliente")).toBeUndefined();
    expect(() => optionalSyncVersion({ version: 0 }, "pago_cliente")).toThrow(
      "Versión de sync inválida",
    );
    expect(() => optionalSyncVersion({ version: 1.5 }, "pago_cliente")).toThrow(
      "Versión de sync inválida",
    );
  });

  it("rechaza esquemas y cuotas con semántica imposible", () => {
    expect(() => validatePlanInstallmentSyncRecord({
      numero_cuota: 2,
      orden: 1,
      dias_cobertura: 30,
      importe: "50.00",
    })).toThrow("número/orden");
    expect(() => validateMembershipInstallmentSyncRecord({
      numero_cuota: 1,
      dias_cobertura: 30,
      importe: "50.00",
      estado: "PAGADA",
      fecha_exigible: new Date("2026-07-01T00:00:00.000Z"),
      fecha_cobertura_inicio: new Date("2026-07-01T00:00:00.000Z"),
      fecha_cobertura_fin: new Date("2026-07-31T00:00:00.000Z"),
      fecha_pagada: null,
    })).toThrow("coherentes");
    expect(() => validateMembershipInstallmentSyncRecord({
      numero_cuota: 1,
      dias_cobertura: 30,
      importe: "50.00",
      estado: "PENDIENTE",
      fecha_exigible: new Date("2026-07-01T00:00:00.000Z"),
      fecha_cobertura_inicio: new Date("2026-07-01T00:00:00.000Z"),
      fecha_cobertura_fin: new Date("2026-07-31T00:00:00.000Z"),
      fecha_pagada: "fecha-inválida",
    })).toThrow("coherentes");
    const valid = {
      numero_cuota: 1,
      dias_cobertura: 30,
      importe: "50.00",
      estado: "pagada",
      fecha_exigible: new Date("2026-07-01T00:00:00.000Z"),
      fecha_cobertura_inicio: new Date("2026-07-01T00:00:00.000Z"),
      fecha_cobertura_fin: new Date("2026-07-31T00:00:00.000Z"),
      fecha_pagada: new Date("2026-07-01T12:00:00.000Z"),
    };
    expect(() => validateMembershipInstallmentSyncRecord(valid)).not.toThrow();
    expect(valid.estado).toBe("PAGADA");
  });
});
