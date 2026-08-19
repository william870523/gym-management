import { describe, expect, it } from "bun:test";
import { actorDeLaCadena, solicitudIdDe } from "./cierre-cadena-solicitud.service";

/**
 * M5 — lo que hace que pedir un cierre sea idempotente.
 *
 * El identificador se deriva del período a propósito: si fuera aleatorio, cada
 * clic de contabilidad central dejaría **una solicitud más y un aviso más en
 * cada sede**, y el semáforo no sabría contra cuál de ellas medir. Es la misma
 * regla de claves deterministas que el guardián de fixtures exige, aquí por el
 * mismo motivo y en código vivo.
 */
describe("M5 · identidad de la solicitud de cierre", () => {
  const julio = {
    tipoPeriodo: "MES",
    fechaInicio: new Date("2026-07-01T00:00:00.000Z"),
    fechaFinExclusiva: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("pedir dos veces el mismo período es la misma solicitud", () => {
    expect(solicitudIdDe(julio)).toBe(solicitudIdDe({ ...julio }));
  });

  it("cada período tiene la suya, y el tipo cuenta", () => {
    const agosto = {
      ...julio,
      fechaInicio: new Date("2026-08-01T00:00:00.000Z"),
      fechaFinExclusiva: new Date("2026-09-01T00:00:00.000Z"),
    };
    expect(solicitudIdDe(agosto)).not.toBe(solicitudIdDe(julio));

    // Mismo rango de fechas, distinto tipo: son cierres distintos y no pueden
    // compartir identidad, o pedir el mes pisaría la petición del rango libre.
    const mismoRangoOtroTipo = { ...julio, tipoPeriodo: "RANGO" };
    expect(solicitudIdDe(mismoRangoOtroTipo)).not.toBe(solicitudIdDe(julio));
  });

  it("el identificador no depende del reloj de quien lo pide", () => {
    // Se deriva solo del período: dos sedes en husos distintos, o el mismo
    // usuario dos días después, tienen que producirlo igual.
    const uno = solicitudIdDe(julio);
    const otro = solicitudIdDe({
      tipoPeriodo: "MES",
      fechaInicio: new Date(Date.UTC(2026, 6, 1)),
      fechaFinExclusiva: new Date(Date.UTC(2026, 7, 1)),
    });
    expect(otro).toBe(uno);
    expect(uno.startsWith("ccs-")).toBeTrue();
  });
});

describe("M5 · quién pide el cierre queda con nombre", () => {
  const baseCon = (fila: any) => ({
    user: {
      async findFirst() {
        return fila;
      },
    },
  });

  it("el nombre sale de la base, porque el token no lo lleva", async () => {
    // Antes se tomaba del token y allí no está, así que la solicitud quedaba
    // firmada por «—»: parecía auditada y no lo estaba.
    const actor = await actorDeLaCadena(
      baseCon({ user_id: "u-dueno", user_nombre: "Ana Cadena", role: "admin" }),
      "u-dueno",
    );
    expect(actor).toEqual({ userId: "u-dueno", nombre: "Ana Cadena", rol: "admin" });
  });

  it("una cuenta sin nombre se identifica por su id, no por un guion", async () => {
    const actor = await actorDeLaCadena(
      baseCon({ user_id: "u-dueno", user_nombre: "   ", role: null }),
      "u-dueno",
    );
    expect(actor.nombre).toBe("u-dueno");
    expect(actor.rol).toBe("user");
  });

  it("sin sesión identificable no se pide nada", async () => {
    expect(actorDeLaCadena(baseCon(null), "")).rejects.toThrow(/identificar/);
  });

  it("una cuenta que ya no está activa tampoco pide", async () => {
    // Falla cerrado: es el criterio del actor congelado en todo el proyecto.
    expect(actorDeLaCadena(baseCon(null), "u-baja")).rejects.toThrow(/activa/);
  });
});
