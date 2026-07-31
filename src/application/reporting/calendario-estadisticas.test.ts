import { describe, expect, it } from "bun:test";
import {
  calendarioLocal,
  diaCanonico,
  mesCanonico,
} from "./calendario-estadisticas";

describe("calendario estadístico de la sede", () => {
  it("proyecta cada instante con su offset histórico, incluido DST", () => {
    const invierno = calendarioLocal(
      new Date("2026-01-15T13:00:00.000Z"),
      "America/New_York",
    );
    const verano = calendarioLocal(
      new Date("2026-07-15T13:00:00.000Z"),
      "America/New_York",
    );

    expect(invierno.hora).toBe(8);
    expect(verano.hora).toBe(9);
  });

  it("conserva las fechas contractuales como días canónicos, sin desplazarlas", () => {
    const fecha = new Date("2026-07-01T00:00:00.000Z");
    expect(diaCanonico(fecha)).toBe("2026-07-01");
    expect(mesCanonico(fecha)).toBe("2026-07");
  });
});

