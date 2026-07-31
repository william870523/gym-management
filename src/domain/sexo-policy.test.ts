import { describe, expect, it } from "bun:test";
import {
  exigirSexoCanonico,
  normalizarSexo,
  normalizarSexoOpcional,
  SEXO_FEMENINO,
  SEXO_MASCULINO,
  SEXO_OTRO,
  SEXOS_CANONICOS,
  SexoInvalido,
} from "./sexo-policy";

/**
 * Regresión del 31-07-2026: cuatro formas de escribir dos sexos.
 *
 * El formulario guardaba `Masculino`/`Femenino` y los scripts de fixture
 * escribían `M`/`F` directamente en la base. Con la columna en texto libre y
 * sin normalización en el servidor, ambas convivieron —53/51/2/1 en socios— y
 * cualquier agrupación por sexo salía con cuatro porciones.
 */
describe("vocabulario del sexo", () => {
  it("solo admite lo que se ve en pantalla", () => {
    expect(SEXOS_CANONICOS).toEqual(["Masculino", "Femenino", "Otro"]);
  });

  it("traduce las formas heredadas que sí se saben leer", () => {
    for (const entrada of ["M", "m", "masculino", "MASCULINO", " Masculino "]) {
      expect(normalizarSexo(entrada)).toBe(SEXO_MASCULINO);
    }
    for (const entrada of ["F", "f", "femenino", "Femenino", "MUJER"]) {
      expect(normalizarSexo(entrada)).toBe(SEXO_FEMENINO);
    }
    for (const entrada of ["O", "otro", "Otra", "X"]) {
      expect(normalizarSexo(entrada)).toBe(SEXO_OTRO);
    }
  });

  it("no depende de los acentos", () => {
    expect(normalizarSexo("Otró")).toBe(SEXO_OTRO);
  });

  it("no adivina por la primera letra", () => {
    // «Mujer» empieza por M. Adivinar la habría convertido en masculino sin
    // que nadie se enterara; por eso la lista es explícita.
    expect(normalizarSexo("Mujer")).toBe(SEXO_FEMENINO);
    expect(normalizarSexo("Masajista")).toBeNull();
  });

  it("un valor ilegible no es «Otro»: es un dato que no se entiende", () => {
    for (const entrada of ["", "   ", "?", "sin dato", null, undefined, 7]) {
      expect(normalizarSexo(entrada)).toBeNull();
    }
    expect(normalizarSexo("Otro")).toBe(SEXO_OTRO);
  });

  it("al escribir, rechaza en vez de guardar una quinta forma", () => {
    expect(() => exigirSexoCanonico("no binario")).toThrow(SexoInvalido);
    expect(() => exigirSexoCanonico("")).toThrow(SexoInvalido);
    expect(exigirSexoCanonico("M")).toBe(SEXO_MASCULINO);
    try {
      exigirSexoCanonico("qwe");
    } catch (error) {
      expect(String(error)).toContain("Masculino, Femenino, Otro");
    }
  });

  it("la ausencia se deja pasar, para poder editar sin tocar el sexo", () => {
    expect(normalizarSexoOpcional(undefined)).toBeUndefined();
    expect(normalizarSexoOpcional("F")).toBe(SEXO_FEMENINO);
    // `null` sí es un intento de escribir: no se cuela.
    expect(() => normalizarSexoOpcional(null)).toThrow(SexoInvalido);
  });
});
