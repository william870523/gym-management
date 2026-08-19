import { describe, expect, it } from "bun:test";
import { certificadoIdDe, claveDelPeriodo } from "./certificado-cadena.service";

/**
 * M6 — la identidad del certificado.
 *
 * Lo que se fija aquí es que rehacer un certificado **no pise** el anterior. Un
 * período puede necesitar otro —una sede reabrió y volvió a cerrar, llegó un
 * cobro que faltaba— y el viejo tiene que seguir ahí: «esto es lo que se cerró en
 * julio» deja de ser demostrable en cuanto la corrección de agosto ocupa su
 * sitio.
 */
const JULIO = {
  fechaInicio: new Date("2026-07-01T00:00:00.000Z"),
  fechaFinExclusiva: new Date("2026-08-01T00:00:00.000Z"),
};

describe("M6 · identidad del certificado", () => {
  it("cada ciclo del mismo período tiene su propio identificador", () => {
    const clave = claveDelPeriodo(JULIO, "MES");
    expect(certificadoIdDe(clave, 1)).not.toBe(certificadoIdDe(clave, 2));
  });

  it("el mismo período y ciclo dan siempre el mismo identificador", () => {
    // Determinista: reintentar la misma firma no puede fabricar una fila nueva.
    const clave = claveDelPeriodo(JULIO, "MES");
    expect(certificadoIdDe(clave, 1)).toBe(certificadoIdDe(claveDelPeriodo(JULIO, "MES"), 1));
    expect(certificadoIdDe(clave, 1).startsWith("ccc-")).toBeTrue();
  });

  it("dos períodos distintos no comparten clave", () => {
    const agosto = {
      fechaInicio: new Date("2026-08-01T00:00:00.000Z"),
      fechaFinExclusiva: new Date("2026-09-01T00:00:00.000Z"),
    };
    expect(claveDelPeriodo(agosto, "MES")).not.toBe(claveDelPeriodo(JULIO, "MES"));
  });

  it("el mismo rango con otro tipo es otro certificado", () => {
    // Cerrar julio como mes y como rango libre son dos cierres distintos; que
    // compartieran clave dejaría uno pisando al otro.
    expect(claveDelPeriodo(JULIO, "RANGO")).not.toBe(claveDelPeriodo(JULIO, "MES"));
  });

  it("la clave no depende del reloj de quien firma", () => {
    const otraInstancia = {
      fechaInicio: new Date(Date.UTC(2026, 6, 1)),
      fechaFinExclusiva: new Date(Date.UTC(2026, 7, 1)),
    };
    expect(claveDelPeriodo(otraInstancia, "mes")).toBe(claveDelPeriodo(JULIO, "MES"));
  });
});
