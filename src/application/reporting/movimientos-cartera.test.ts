import { describe, expect, it } from "bun:test";
import { movimientosCarteraPorMes } from "./movimientos-cartera";

describe("movimientos reales de una cartera", () => {
  it("no convierte una renovación contigua en pérdida y alta", () => {
    const resultado = movimientosCarteraPorMes(
      [
        {
          ci: "socio-1",
          desde: new Date("2026-01-01T13:00:00.000Z"),
          hasta: new Date("2026-02-01T13:00:00.000Z"),
        },
        {
          ci: "socio-1",
          desde: new Date("2026-02-01T13:00:00.000Z"),
          hasta: null,
        },
      ],
      "America/Havana",
    );

    expect(resultado).toEqual([{ mes: "2026-01", altas: 1, bajas: 0 }]);
  });

  it("cuenta una salida y un regreso separados como movimientos distintos", () => {
    const resultado = movimientosCarteraPorMes(
      [
        {
          ci: "socio-1",
          desde: new Date("2026-01-10T12:00:00.000Z"),
          hasta: new Date("2026-02-10T12:00:00.000Z"),
        },
        {
          ci: "socio-1",
          desde: new Date("2026-04-10T12:00:00.000Z"),
          hasta: null,
        },
      ],
      "America/Havana",
    );

    expect(resultado).toEqual([
      { mes: "2026-01", altas: 1, bajas: 0 },
      { mes: "2026-02", altas: 0, bajas: 1 },
      { mes: "2026-04", altas: 1, bajas: 0 },
    ]);
  });
});

