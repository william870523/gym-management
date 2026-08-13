/**
 * Unidad 09 — el actor de un gasto o un cierre viaja congelado dentro del
 * evento, y la subida lo valida como tal.
 *
 * Regresión de un defecto real medido el 31-07-2026: el remoto exigía que
 * `registrada_por_user_id` tuviera fila en `User`, así que **todo gasto
 * registrado desde una cuenta local del escritorio se rechazaba**. El evento se
 * quedaba en el outbox reintentando y la fila vivía solo en SQLite: divergencia
 * silenciosa, sin un solo error visible para el operador.
 *
 * Que las cuentas locales no tengan fila remota no es una anomalía: es lo que
 * R5.6 estableció para el dinero (`docs/PAYMENT_COLLECTOR_ATTRIBUTION.md` §4) y
 * lo que hace que los 602 cobros de la simulación sí sincronizaran mientras el
 * primer gasto no.
 */
import { describe, expect, it } from "bun:test";
import { UploadEventsUseCase } from "./UploadEventsUseCase";
import { frozenActorIsValid } from "../../accounting/frozen-actor";

const GYM = "local-gym-001";

/** Cliente mínimo: todas las referencias existen y el mes está abierto. */
function stubClient() {
  return {
    // Nulable a propósito: `findFirst` de Prisma devuelve `T | null`, y hay una
    // prueba que sustituye este doble por uno que no encuentra nada. Sin el tipo
    // explícito, TypeScript infería «siempre encuentra» y esa sustitución no
    // compilaba —era uno de los errores heredados de la deuda—.
    gastoCategoria: {
      findFirst: async (): Promise<{ categoria_id: string } | null> => ({
        categoria_id: "cat-1",
      }),
    },
    gastoProveedor: { findFirst: async () => ({ proveedor_id: "prov-1" }) },
    moneda: { findFirst: async () => ({ moneda_id: "cup" }) },
    gastoRecurrente: { findFirst: async () => ({ recurrente_id: "rec-1" }) },
    tesoreriaCierreMensual: { findFirst: async () => null },
    // Si la validación volviera a consultar usuarios, el test lo denuncia en
    // vez de pasar por casualidad.
    user: {
      findFirst: async () => {
        throw new Error(
          "La subida no debe consultar `User` para validar el actor congelado.",
        );
      },
    },
  };
}

function expenseRecord(overrides: Record<string, unknown> = {}) {
  return {
    gasto_id: "gasto-1",
    categoria_id: "cat-1",
    proveedor_id: "prov-1",
    moneda_id: "cup",
    monto: 120,
    periodo_pertenencia_mes: "2026-07",
    estado: "PENDIENTE",
    registrada_por_user_id: "ca76c6c2-f8da-42a3-9e2e-e9b8d8d27c42",
    registrada_por_nombre_snapshot: "simulacion.admin",
    registrada_por_rol_snapshot: "admin",
    registrada_por_origen: "LOCAL_USER",
    ...overrides,
  };
}

function validate(record: Record<string, unknown>) {
  const useCase = Object.create(UploadEventsUseCase.prototype) as any;
  return useCase.validateParityEntityReferences(
    "gasto_gobernado",
    String(record.gasto_id),
    record,
    GYM,
    "INSERT",
    stubClient(),
  );
}

describe("subida de gasto gobernado — actor congelado", () => {
  it("acepta una cuenta local que nunca tendrá fila en el remoto", async () => {
    await validate(expenseRecord());
  });

  it("acepta al usuario de la web y al sincronizado", async () => {
    await validate(expenseRecord({ registrada_por_origen: "REMOTE_USER" }));
    await validate(expenseRecord({ registrada_por_origen: "SYNCED_USER" }));
  });

  it("acepta la generación automática de un gasto recurrente", async () => {
    await validate(
      expenseRecord({
        registrada_por_user_id: "SYSTEM",
        registrada_por_origen: "SYSTEM",
      }),
    );
  });

  it("rechaza un gasto cuyo actor viaja sin origen", async () => {
    await expect(
      validate(expenseRecord({ registrada_por_origen: null })),
    ).rejects.toThrow(/actor que lo registró no viaja completo/);
  });

  it("rechaza un origen inventado", async () => {
    await expect(
      validate(expenseRecord({ registrada_por_origen: "CUALQUIERA" })),
    ).rejects.toThrow(/actor que lo registró no viaja completo/);
  });

  it("rechaza un gasto sin identificador de actor", async () => {
    await expect(
      validate(expenseRecord({ registrada_por_user_id: "  " })),
    ).rejects.toThrow(/actor que lo registró no viaja completo/);
  });

  it("sigue rechazando una categoría de otro gimnasio", async () => {
    const useCase = Object.create(UploadEventsUseCase.prototype) as any;
    const client = stubClient();
    client.gastoCategoria = { findFirst: async () => null };
    await expect(
      useCase.validateParityEntityReferences(
        "gasto_gobernado",
        "gasto-1",
        expenseRecord(),
        GYM,
        "INSERT",
        client,
      ),
    ).rejects.toThrow(/no pertenece al gimnasio autenticado/);
  });
});

describe("orígenes válidos de un actor congelado", () => {
  it("admite los tres humanos y el automático", () => {
    for (const origen of [
      "LOCAL_USER",
      "SYNCED_USER",
      "REMOTE_USER",
      "SYSTEM",
    ]) {
      expect(frozenActorIsValid({ userId: "u-1", origen })).toBe(true);
    }
  });

  it("no admite vacío, nulo ni inventado", () => {
    expect(frozenActorIsValid({ userId: "u-1", origen: "" })).toBe(false);
    expect(frozenActorIsValid({ userId: "u-1", origen: null })).toBe(false);
    expect(frozenActorIsValid({ userId: "u-1", origen: "ADMIN" })).toBe(false);
  });

  it("exige identificador aunque el origen sea válido", () => {
    expect(frozenActorIsValid({ userId: "", origen: "LOCAL_USER" })).toBe(false);
    expect(frozenActorIsValid({ userId: null, origen: "LOCAL_USER" })).toBe(
      false,
    );
  });
});
