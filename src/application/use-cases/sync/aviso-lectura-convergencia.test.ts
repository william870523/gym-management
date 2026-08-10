import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * R5.4 · Unidad 08 — regla de convergencia del aviso de administración.
 *
 * **«Leído» gana y nunca retrocede.**
 *
 * El manual de la unidad lo exige así: «marcar leído en un lado no debe
 * perderse al sincronizar el otro». Sin la regla, el upsert genérico es
 * «gana el último que llega», y eso produce un fallo desagradable de
 * diagnosticar: administración marca un aviso como atendido, y minutos después
 * reaparece pendiente porque el otro lado subió su copia sin leer. No hay error
 * en el registro, no hay evento fallido; simplemente la bandeja miente.
 *
 * La regla es **monótona**: se puede marcar desde el escritorio o desde la web,
 * en cualquier orden, y el resultado converge a «leído». Es lo que permite que
 * las dos superficies trabajen sobre la misma bandeja sin coordinarse.
 *
 * Esta prueba vigila que la regla siga existiendo **en los dos sentidos**. La
 * comprobación de comportamiento con datos reales vive en la verificación de
 * sincronización de la unidad, que necesita las dos bases levantadas.
 */
const BAJADA = resolve(
  import.meta.dir,
  "../../../../../gym-local-api/src/infrastructure/sync/sync-worker.ts",
);
const SUBIDA = resolve(import.meta.dir, "./UploadEventsUseCase.ts");

/** Extrae el bloque que decide la convergencia, si existe. */
function reglaDeConvergencia(fuente: string) {
  // La entidad aparece varias veces —en el mapa de delegados, en listas—, así
  // que hay que recorrerlas todas: quedarse con la primera hacía que la prueba
  // no encontrara la regla aunque estuviera escrita.
  for (const coincidencia of fuente.matchAll(/aviso_administracion/g)) {
    const indice = coincidencia.index ?? 0;
    const ventana = fuente.slice(Math.max(0, indice - 1200), indice + 1200);
    if (/leido === false/.test(ventana) && /leido = true/.test(ventana)) {
      return ventana;
    }
  }
  return null;
}

describe("aviso de administración · convergencia de «leído»", () => {
  test("la bajada al escritorio conserva el «leído» local", () => {
    const fuente = readFileSync(BAJADA, "utf8");
    expect(fuente).toContain("aviso_administracion");
    expect(reglaDeConvergencia(fuente)).not.toBeNull();
  });

  test("la subida al remoto conserva el «leído» remoto", () => {
    const fuente = readFileSync(SUBIDA, "utf8");
    expect(fuente).toContain("aviso_administracion");
    expect(reglaDeConvergencia(fuente)).not.toBeNull();
  });

  test("la regla es monótona: nunca se escribe `leido = false` al converger", () => {
    for (const ruta of [BAJADA, SUBIDA]) {
      const ventana = reglaDeConvergencia(readFileSync(ruta, "utf8"));
      // Si alguien invirtiera la regla —«gana el último»— aparecería una
      // asignación a false dentro del mismo bloque.
      expect(/leido = false/.test(ventana ?? "")).toBe(false);
    }
  });
});
