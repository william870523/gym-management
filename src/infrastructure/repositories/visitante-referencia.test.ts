import { describe, expect, it } from "bun:test";
import { esVisitanteAutorizado } from "./visitante-referencia";

/**
 * La excepción al aislamiento por sede es la puerta más delicada de M4a: deja
 * que una asistencia referencie a un socio de OTRA sede. Por eso se prueba por
 * el lado que importa —cuándo NO se abre— y no solo por el feliz.
 */
const HOY = new Date("2026-08-16T00:00:00.000Z");

/** Doble mínimo: un socio y su acceso, tal y como los lee el repositorio. */
function baseCon(cliente: any, acceso: any) {
  return {
    cliente: { findFirst: async () => cliente },
    clienteAccesoMultisede: { findFirst: async () => acceso },
  };
}

const accesoVigente = {
  activo: true,
  is_deleted: false,
  vigente_hasta: "2026-10-16T00:00:00.000Z",
};

describe("esVisitanteAutorizado · la única excepción al aislamiento", () => {
  it("abre para el socio de otra sede con el plus vigente", async () => {
    const tx = baseCon({ gym_id: "gym-oeste" }, accesoVigente);
    expect(
      await esVisitanteAutorizado({ tx, ci: "91021020015", gymId: "gym-test", fechaNegocio: HOY }),
    ).toBe(true);
  });

  it("no abre para un socio de la propia sede", async () => {
    // No es un visitante: es un socio de la casa, y su referencia la valida el
    // aislamiento de siempre. Abrir aquí sería saltárselo sin motivo.
    const tx = baseCon({ gym_id: "gym-test" }, accesoVigente);
    expect(
      await esVisitanteAutorizado({ tx, ci: "91021020015", gymId: "gym-test", fechaNegocio: HOY }),
    ).toBe(false);
  });

  it("no abre sin plus, con el plus caducado, retirado o borrado", async () => {
    const casos = [
      null,
      { activo: true, is_deleted: false, vigente_hasta: "2026-08-01T00:00:00.000Z" },
      { activo: false, is_deleted: false, vigente_hasta: "2026-10-16T00:00:00.000Z" },
      { activo: true, is_deleted: true, vigente_hasta: "2026-10-16T00:00:00.000Z" },
    ];
    for (const acceso of casos) {
      const tx = baseCon({ gym_id: "gym-oeste" }, acceso);
      expect(
        await esVisitanteAutorizado({ tx, ci: "91021020015", gymId: "gym-test", fechaNegocio: HOY }),
      ).toBe(false);
    }
  });

  it("no abre si el socio no existe o no tiene sede conocida", async () => {
    for (const cliente of [null, { gym_id: null }, { gym_id: "  " }]) {
      const tx = baseCon(cliente, accesoVigente);
      expect(
        await esVisitanteAutorizado({ tx, ci: "91021020015", gymId: "gym-test", fechaNegocio: HOY }),
      ).toBe(false);
    }
  });

  it("no abre con una identificación vacía, y ni siquiera consulta", async () => {
    let consultado = false;
    const tx = {
      cliente: { findFirst: async () => { consultado = true; return null; } },
      clienteAccesoMultisede: { findFirst: async () => accesoVigente },
    };
    expect(
      await esVisitanteAutorizado({ tx, ci: "   ", gymId: "gym-test", fechaNegocio: HOY }),
    ).toBe(false);
    expect(consultado).toBe(false);
  });
});
