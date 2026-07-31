import { describe, expect, it } from "bun:test";
import type { EstadisticasRankingsReader } from "./estadisticas-rankings.reader";
import { EstadisticasRankingsService } from "./estadisticas-rankings.service";

const asistencia = () => [
  {
    ci: "1",
    nombre: "Constante",
    visitas: 8,
    visitasAnterior: 4,
    ultimaVisita: new Date("2026-07-29T12:00:00.000Z"),
    ultimaVisitaAnterior: new Date("2026-06-28T12:00:00.000Z"),
    fechaInicio: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    ci: "2",
    nombre: "Ausente",
    visitas: 0,
    visitasAnterior: 2,
    ultimaVisita: null,
    ultimaVisitaAnterior: new Date("2026-06-20T12:00:00.000Z"),
    fechaInicio: new Date("2026-07-01T00:00:00.000Z"),
  },
];

const reader: EstadisticasRankingsReader = {
  async leerIndicadoresAlerta() {
    return {
      visitas: { actual: 40, anterior: 44 },
      mora: [],
    };
  },
  async leerResumen() {
    return {
      sociosRegistrados: 4,
      sociosActivos: 3,
      sociosConCobertura: 2,
      menores18: 1,
      sinFechaNacimiento: 1,
      porSexo: [{ etiqueta: "F", total: 2 }, { etiqueta: "M", total: 2 }],
    };
  },
  async leerPlanes() {
    return [
      { id: "p2", nombre: "Dos", vendidos: 2, vendidosAnterior: 4, sociosConCobertura: 2, renovaciones: 1 },
      { id: "p1", nombre: "Uno", vendidos: 5, vendidosAnterior: 2, sociosConCobertura: 1, renovaciones: 0 },
    ];
  },
  async leerEntrenadores() {
    return [{ id: "e1", nombre: "Ana", carteraActiva: 3, carteraActivaAnterior: 2, ganados: 2, perdidos: 1 }];
  },
  async leerSociosPorVisitas() {
    return asistencia();
  },
  async leerSociosPorInactividad() {
    return asistencia();
  },
  async leerCambiosEntrenador() {
    return [{ ci: "2", nombre: "Ausente", cambios: 2, cambiosAnterior: 1 }];
  },
  async leerValorSocios() {
    return [
      { ci: "1", nombre: "Constante", monedaId: "cup", total: 30, totalAnterior: 10 },
      { ci: "2", nombre: "Ausente", monedaId: "cup", total: 90, totalAnterior: 120 },
      { ci: "1", nombre: "Constante", monedaId: "eur", total: 10, totalAnterior: 0 },
    ];
  },
  async leerRanking(consulta) {
    return {
      total: 53,
      filas: [
        {
          id: "e1",
          nombre: `Ana ${consulta.busqueda}`,
          carteraActiva: 12,
          carteraActivaAnterior: 10,
          ganados: 4,
          perdidos: 1,
        },
      ],
    };
  },
};

describe("EstadisticasRankingsService", () => {
  it("ordena rankings, separa monedas y explica la inactividad observada", async () => {
    const salida = await new EstadisticasRankingsService(reader).portada({
      gymId: "gym",
      zona: "America/Havana",
      hoy: new Date("2026-07-30T00:00:00.000Z"),
      dias: 30,
      limite: 5,
    });
    expect(salida.periodo.desde).toBe("2026-07-01");
    expect(salida.periodoAnterior.desde).toBe("2026-06-01");
    expect(salida.planes.map((fila) => fila.id)).toEqual(["p1", "p2"]);
    expect(salida.socios.porInactividad[0]).toMatchObject({
      ci: "2",
      diasSinVisita: 29,
      ultimaVisita: null,
    });
    expect(salida.socios.porValor[0]?.monedaId).toBe("cup");
    expect(salida.socios.porValor[0]?.ranking[0]?.ci).toBe("2");
  });

  it("avisa de un plan hundido aunque no entre en el Top 5 de la portada", async () => {
    const conCatalogoLargo: EstadisticasRankingsReader = {
      ...reader,
      async leerPlanes() {
        return [
          ...Array.from({ length: 6 }, (_, indice) => ({
            id: `alto${indice}`,
            nombre: `Alto ${indice}`,
            vendidos: 20 + indice,
            vendidosAnterior: 20 + indice,
            sociosConCobertura: 10,
            renovaciones: 5,
          })),
          {
            id: "hundido",
            nombre: "Trimestral",
            vendidos: 2,
            vendidosAnterior: 12,
            sociosConCobertura: 3,
            renovaciones: 0,
          },
        ];
      },
    };

    const salida = await new EstadisticasRankingsService(conCatalogoLargo)
      .portada({
        gymId: "gym",
        zona: "America/Havana",
        hoy: new Date("2026-07-30T00:00:00.000Z"),
        dias: 30,
        limite: 5,
      });

    expect(salida.planes).toHaveLength(5);
    expect(salida.planes.map((fila) => fila.id)).not.toContain("hundido");
    expect(
      salida.alertas.find((fila) =>
        fila.id === "plan-contratacion-caida:hundido"
      ),
    ).toMatchObject({
      familia: "plan",
      severidad: "peligro",
      destino: { tipo: "plan", id: "hundido" },
      muestra: { valor: 2, base: 12 },
    });
    expect(salida.reglasAlerta).toHaveLength(5);
  });

  it("pagina y conserva búsqueda y orden en el servidor", async () => {
    const salida = await new EstadisticasRankingsService(reader).ranking({
      gymId: "gym",
      zona: "America/Havana",
      hoy: new Date("2026-07-30T00:00:00.000Z"),
      tipo: "entrenadores",
      dias: 90,
      pagina: 2,
      tamano: 25,
      busqueda: "  pérez  ",
      orden: "ganados",
      direccion: "asc",
    });

    expect(salida.pagina).toEqual({
      numero: 2,
      tamano: 25,
      total: 53,
      totalPaginas: 3,
    });
    expect(salida.busqueda).toBe("pérez");
    expect(salida.orden).toBe("ganados");
    expect(salida.direccion).toBe("asc");
    expect(salida.filas[0]).toMatchObject({
      id: "e1",
      carteraActiva: 12,
      comparacion: {
        actual: 12,
        anterior: 10,
        delta: 2,
        variacionPorcentual: 20,
      },
    });
  });

  it("exporta CSV auditable con filtros y comparación sin limitarse a la página visible", async () => {
    const salida = await new EstadisticasRankingsService(reader).exportarCsv({
      gymId: "gym",
      zona: "America/Havana",
      hoy: new Date("2026-07-30T00:00:00.000Z"),
      tipo: "entrenadores",
      dias: 90,
      busqueda: "pérez",
      orden: "ganados",
      direccion: "asc",
    });

    expect(salida.contenido.startsWith("\uFEFF")).toBe(true);
    expect(salida.contenido).toContain('"periodo_anterior_desde"');
    expect(salida.contenido).toContain('"America/Havana"');
    expect(salida.contenido).toContain('"pérez"');
    expect(salida.contenido).toContain('"carteraActiva","12","10","2","20"');
    expect(salida.nombreArchivo).toBe(
      "estadisticas-entrenadores-2026-05-02-a-2026-07-30.csv",
    );
  });
});
