/**
 * R5.3 — la regla de quién cambia la categoría, y con qué.
 *
 * Estas pruebas están **duplicadas a propósito** en `gym-remote-api`: la
 * política es un fichero gemelo y lo que se comprueba es que las dos copias
 * digan lo mismo. Una regla que decide dinero no puede significar cosas
 * distintas en el escritorio y en la web.
 */
import { describe, expect, test } from "bun:test";
import {
  decidirCambioCategoria,
  mensajeCambioCategoria,
  MOTIVO_CATEGORIA_MIN,
} from "./cliente-categoria-policy";

const base = {
  categoriaActual: "NUEVO",
  categoriaEntrante: "VIEJO",
  rol: "admin",
  motivo: "Ya fue socio entre 2023 y 2024.",
};

describe("cambio de categoría del socio", () => {
  test("administración puede cambiarla si da un motivo", () => {
    const d = decidirCambioCategoria(base);

    expect(d.permitido).toBe(true);
    expect(d.permitido && d.huboCambio).toBe(true);
  });

  test("recepción no puede, y se le dice dónde sí puede elegir", () => {
    const d = decidirCambioCategoria({ ...base, rol: "reception" });

    expect(d.permitido).toBe(false);
    if (!d.permitido) {
      expect(d.status).toBe(403);
      // El mensaje no puede ser un «no» seco: el alta sí es suya.
      expect(d.error).toContain("darlo de alta");
    }
  });

  test("administración sin motivo tampoco", () => {
    const d = decidirCambioCategoria({ ...base, motivo: "   " });

    expect(d.permitido).toBe(false);
    if (!d.permitido) expect(d.status).toBe(400);
  });

  test("un motivo demasiado corto no vale por motivo", () => {
    const d = decidirCambioCategoria({ ...base, motivo: "x".repeat(MOTIVO_CATEGORIA_MIN - 1) });

    expect(d.permitido).toBe(false);
  });

  test("reenviar la misma categoría no es un cambio y no pide nada", () => {
    // El formulario manda el objeto entero al guardar. Si esto exigiera
    // motivo, corregir un teléfono se convertiría en un interrogatorio.
    const d = decidirCambioCategoria({
      categoriaActual: "VIEJO",
      categoriaEntrante: "VIEJO",
      rol: "reception",
      motivo: null,
    });

    expect(d.permitido).toBe(true);
    expect(d.permitido && d.huboCambio).toBe(false);
  });

  test("no mandar categoría tampoco es un cambio", () => {
    const d = decidirCambioCategoria({
      categoriaActual: "VIEJO",
      categoriaEntrante: undefined,
      rol: "reception",
      motivo: null,
    });

    expect(d.permitido && d.huboCambio).toBe(false);
  });

  test("compara sin distinguir mayúsculas ni espacios", () => {
    const d = decidirCambioCategoria({
      categoriaActual: "viejo",
      categoriaEntrante: "  VIEJO ",
      rol: "reception",
      motivo: null,
    });

    expect(d.permitido && d.huboCambio).toBe(false);
  });

  test("una categoría inventada se rechaza antes de mirar el rol", () => {
    const d = decidirCambioCategoria({ ...base, categoriaEntrante: "PREMIUM", rol: "admin" });

    expect(d.permitido).toBe(false);
    if (!d.permitido) expect(d.status).toBe(400);
  });

  test("un socio sin categoría se trata como NUEVO", () => {
    // `categoria` tiene `@default("NUEVO")`; una fila antigua sin valor no
    // puede hacer que pasar a NUEVO cuente como cambio.
    const d = decidirCambioCategoria({
      categoriaActual: null,
      categoriaEntrante: "NUEVO",
      rol: "reception",
      motivo: null,
    });

    expect(d.permitido && d.huboCambio).toBe(false);
  });

  test("el aviso dice quién era, en qué pasó a ser y por qué", () => {
    const m = mensajeCambioCategoria({
      ci: "85042012345",
      nombre: "Juan Pérez",
      desde: "NUEVO",
      hasta: "VIEJO",
      motivo: "Volvió tras el cierre de la sede del Vedado.",
    });

    expect(m).toContain("85042012345");
    expect(m).toContain("NUEVO");
    expect(m).toContain("VIEJO");
    expect(m).toContain("Vedado");
  });
});
