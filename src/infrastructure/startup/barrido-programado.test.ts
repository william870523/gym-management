import { describe, expect, it } from "bun:test";
import {
  estadoDelBarrido,
  programarBarridoDeVisitantes,
} from "./barrido-programado";

/**
 * M4a §9-bis — quién barre y quién no.
 *
 * Lo que se fija aquí es el reparto, que es donde duele: dos concentradores
 * barriendo a la vez emitirían la baja de la misma copia dos veces, y ese es
 * exactamente el accidente del 31-07-2026 con las tres APIs locales huérfanas.
 * Y que «no corrió» se pueda distinguir de «no encontró nada», que es como se
 * pasaron meses sin que corriera.
 */
describe("programación del barrido de visitantes", () => {
  it("no programa nada si ya hay otro concentrador vivo", () => {
    const estado = programarBarridoDeVisitantes({
      otrasInstancias: 1,
      intervaloHoras: 12,
      habilitado: true,
    });
    expect(estado.programado).toBeFalse();
    expect(estado.motivo).toContain("instancia");
    // No es un error: es el reparto correcto, y por eso lo dice con palabras.
    expect(estado.motivo).toContain("barre la primera");
  });

  it("se puede apagar sin tocar código", () => {
    // Hace falta para las bases de prueba y para el día que haya que pararlo
    // sin desplegar.
    const estado = programarBarridoDeVisitantes({
      otrasInstancias: 0,
      intervaloHoras: 12,
      habilitado: false,
    });
    expect(estado.programado).toBeFalse();
    expect(estado.motivo).toContain("apagado");
  });

  it("la primera instancia sí lo programa, y lo publica", () => {
    const estado = programarBarridoDeVisitantes({
      otrasInstancias: 0,
      intervaloHoras: 6,
      habilitado: true,
      // Lejos: esta prueba fija el reparto, no quiere tocar la base.
      retrasoInicialMs: 60 * 60 * 1000,
    });
    expect(estado.programado).toBeTrue();
    expect(estado.intervaloHoras).toBe(6);
    // Lo mismo que verá `/health`.
    expect(estadoDelBarrido().programado).toBeTrue();
  });

  it("antes de correr, el estado no finge que corrió", () => {
    // «Sin ejecuciones» y «ejecutado sin retiradas» son cosas distintas, y
    // confundirlas es lo que dejó el barrido parado sin que nadie lo notara.
    programarBarridoDeVisitantes({
      otrasInstancias: 0,
      intervaloHoras: 12,
      habilitado: true,
      retrasoInicialMs: 60 * 60 * 1000,
    });
    expect(estadoDelBarrido().ultimaEjecucion).toBeUndefined();
  });
});
