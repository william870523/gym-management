import { describe, expect, it } from "bun:test";
import { PrismaAsistenciaRepository } from "./PrismaAsistenciaRepository";

/**
 * El alta y la corrección por HTTP tienen que admitir al visitante igual que
 * la subida por sincronización.
 *
 * Esto no salió de una revisión de código: salió del recorrido web del
 * 16-08-2026. El escritorio dejaba pasar a la visitante y la web contestaba
 * «El cliente no pertenece al gimnasio autenticado», porque la excepción de
 * M4a solo la conocía `upsertAsistencia`. La puerta es una sola; las tres
 * entradas a ella tienen que decir lo mismo.
 */
const SEDE = "gym-test";
const HOY = new Date("2026-08-16T12:00:00.000Z");

/** Base mínima: una sede con su huso, el padrón y los accesos multi-sede. */
function baseCon(opciones: {
  clientePropio?: unknown;
  clienteCualquiera?: unknown;
  acceso?: unknown;
}) {
  const creadas: any[] = [];
  const actualizadas: any[] = [];
  const cliente = {
    findFirst: async ({ where }: any) =>
      where?.gym_id === SEDE
        ? (opciones.clientePropio ?? null)
        : (opciones.clienteCualquiera ?? null),
  };
  return {
    creadas,
    actualizadas,
    tx: {
      gym: { findUnique: async () => ({ timezone: "America/Havana" }) },
      cliente,
      clienteAccesoMultisede: { findFirst: async () => opciones.acceso ?? null },
      asistencia: {
        create: async (args: any) => {
          creadas.push(args.data);
        },
        updateMany: async (args: any) => {
          actualizadas.push(args);
          return { count: 1 };
        },
      },
    },
  };
}

const accesoVigente = {
  activo: true,
  is_deleted: false,
  vigente_hasta: "2026-10-16T00:00:00.000Z",
};

const asistencia = {
  asistencia_id: "asi-1",
  ci: "99090100009",
  fecha_salida: null,
  gym_id: SEDE,
  source_device: null,
  version: 1,
  created_at: HOY,
  updated_at: HOY,
  deleted_at: null,
  is_deleted: false,
} as any;

describe("PrismaAsistenciaRepository · el visitante entra también por HTTP", () => {
  it("crea la asistencia del socio de otra sede con el plus vigente", async () => {
    const base = baseCon({
      clientePropio: null,
      clienteCualquiera: { gym_id: "gym-oeste" },
      acceso: accesoVigente,
    });
    await new PrismaAsistenciaRepository(base.tx).create(asistencia);
    expect(base.creadas).toHaveLength(1);
    expect(base.creadas[0].ci).toBe("99090100009");
  });

  it("sigue rechazando al socio de otra sede sin plus vigente", async () => {
    const base = baseCon({
      clientePropio: null,
      clienteCualquiera: { gym_id: "gym-oeste" },
      acceso: null,
    });
    await expect(
      new PrismaAsistenciaRepository(base.tx).create(asistencia),
    ).rejects.toThrow("El cliente no pertenece al gimnasio autenticado.");
    expect(base.creadas).toHaveLength(0);
  });

  it("sigue admitiendo al socio de la propia sede sin consultar el plus", async () => {
    const base = baseCon({
      clientePropio: { ci: "99090100001" },
      clienteCualquiera: { gym_id: SEDE },
      acceso: null,
    });
    await new PrismaAsistenciaRepository(base.tx).create(asistencia);
    expect(base.creadas).toHaveLength(1);
  });

  it("corregir la asistencia a un visitante autorizado tampoco se rechaza", async () => {
    const base = baseCon({
      clientePropio: null,
      clienteCualquiera: { gym_id: "gym-oeste" },
      acceso: accesoVigente,
    });
    await new PrismaAsistenciaRepository(base.tx).update("asi-1", SEDE, {
      ci: "99090100009",
    });
    expect(base.actualizadas).toHaveLength(1);
  });

  it("corregirla hacia un desconocido de otra sede sí se rechaza", async () => {
    const base = baseCon({
      clientePropio: null,
      clienteCualquiera: { gym_id: "gym-oeste" },
      acceso: null,
    });
    await expect(
      new PrismaAsistenciaRepository(base.tx).update("asi-1", SEDE, {
        ci: "99090100009",
      }),
    ).rejects.toThrow("El cliente no pertenece al gimnasio autenticado.");
    expect(base.actualizadas).toHaveLength(0);
  });
});
