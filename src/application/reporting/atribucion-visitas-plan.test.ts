import { describe, expect, it } from "bun:test";
import { atribuirVisitasAPlan } from "./atribucion-visitas-plan";

describe("atribución de visitas a un plan", () => {
  it("cuenta solo accesos dentro de la cobertura local [inicio, fin)", () => {
    const resultado = atribuirVisitasAPlan(
      [
        {
          ci: "socio-1",
          desde: new Date("2026-07-01T00:00:00.000Z"),
          hasta: new Date("2026-08-01T00:00:00.000Z"),
        },
      ],
      [
        {
          id: "antes",
          ci: "socio-1",
          // En La Habana todavía es 30 de junio.
          instante: new Date("2026-07-01T01:00:00.000Z"),
        },
        {
          id: "dentro",
          ci: "socio-1",
          instante: new Date("2026-07-01T13:00:00.000Z"),
        },
        {
          id: "fin-exclusivo",
          ci: "socio-1",
          instante: new Date("2026-08-01T13:00:00.000Z"),
        },
      ],
      "America/Havana",
    );

    expect(resultado.visitas).toBe(1);
    expect(resultado.socios).toBe(1);
    expect(resultado.porFranja).toEqual([
      { etiqueta: "Mañana", total: 1 },
    ]);
  });

  it("no duplica una asistencia cuando hay coberturas solapadas", () => {
    const resultado = atribuirVisitasAPlan(
      [
        {
          ci: "socio-1",
          desde: new Date("2026-07-01T00:00:00.000Z"),
          hasta: new Date("2026-08-01T00:00:00.000Z"),
        },
        {
          ci: "socio-1",
          desde: new Date("2026-07-15T00:00:00.000Z"),
          hasta: new Date("2026-08-15T00:00:00.000Z"),
        },
      ],
      [
        {
          id: "visita-1",
          ci: "socio-1",
          instante: new Date("2026-07-20T14:00:00.000Z"),
        },
      ],
      "America/Havana",
    );

    expect(resultado.visitas).toBe(1);
    expect(resultado.socios).toBe(1);
  });
});

