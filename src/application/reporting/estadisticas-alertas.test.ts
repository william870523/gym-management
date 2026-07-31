import { describe, expect, it } from "bun:test";
import { calcularAlertas, UMBRALES_ALERTA } from "./estadisticas-alertas";
import type {
  IndicadoresAlerta,
  RankingEntrenador,
  RankingPlan,
  ResumenRankings,
} from "./estadisticas-rankings.reader";

const resumenSano: ResumenRankings = {
  sociosRegistrados: 100,
  sociosActivos: 90,
  sociosConCobertura: 80,
  menores18: 4,
  sinFechaNacimiento: 5,
  porSexo: [{ etiqueta: "F", total: 52 }, { etiqueta: "M", total: 48 }],
};

const indicadoresSanos: IndicadoresAlerta = {
  visitas: { actual: 500, anterior: 500 },
  mora: [],
};

function calcular(entrada: {
  resumen?: ResumenRankings;
  indicadores?: IndicadoresAlerta;
  planes?: RankingPlan[];
  entrenadores?: RankingEntrenador[];
} = {}) {
  return calcularAlertas({
    resumen: entrada.resumen ?? resumenSano,
    indicadores: entrada.indicadores ?? indicadoresSanos,
    planes: entrada.planes ?? [],
    entrenadores: entrada.entrenadores ?? [],
  });
}

function plan(parcial: Partial<RankingPlan> & { id: string }): RankingPlan {
  return {
    nombre: `Plan ${parcial.id}`,
    vendidos: 10,
    vendidosAnterior: 10,
    sociosConCobertura: 5,
    renovaciones: 2,
    ...parcial,
  };
}

function entrenador(
  parcial: Partial<RankingEntrenador> & { id: string },
): RankingEntrenador {
  return {
    nombre: `Entrenador ${parcial.id}`,
    carteraActiva: 10,
    carteraActivaAnterior: 10,
    ganados: 1,
    perdidos: 1,
    ...parcial,
  };
}

describe("calcularAlertas", () => {
  it("no inventa avisos cuando nada cruza su umbral", () => {
    const salida = calcular();
    expect(salida.alertas).toEqual([]);
    expect(salida.omitidas).toBe(0);
    // Las reglas viajan aunque no se dispare ninguna: sin ellas el panel
    // vacío diría «no pasa nada» sin decir qué llegó a mirar.
    expect(salida.reglas.map((regla) => regla.familia)).toEqual([
      "asistencia",
      "mora",
      "plan",
      "entrenador",
      "datos",
    ]);
  });

  it("gradúa la caída de asistencia y lleva al ranking que la explica", () => {
    const aviso = calcular({
      indicadores: { ...indicadoresSanos, visitas: { actual: 83, anterior: 100 } },
    }).alertas[0];
    expect(aviso).toMatchObject({
      id: "asistencia-caida",
      severidad: "aviso",
      destino: { tipo: "ranking", ranking: "socios-inactividad" },
      comparacion: { actual: 83, anterior: 100, delta: -17 },
      muestra: { valor: 83, base: 100 },
    });
    expect(aviso?.detalle).toContain("17 %");

    const peligro = calcular({
      indicadores: { ...indicadoresSanos, visitas: { actual: 60, anterior: 100 } },
    }).alertas[0];
    expect(peligro?.severidad).toBe("peligro");
  });

  it("no evalúa la asistencia por debajo de la muestra mínima", () => {
    const base = UMBRALES_ALERTA.asistencia.baseMinima;
    expect(
      calcular({
        indicadores: {
          ...indicadoresSanos,
          visitas: { actual: 0, anterior: base - 1 },
        },
      }).alertas,
    ).toEqual([]);
    expect(
      calcular({
        indicadores: {
          ...indicadoresSanos,
          visitas: { actual: 0, anterior: base },
        },
      }).alertas,
    ).toHaveLength(1);
  });

  it("avisa de la mora por moneda y jamás las suma", () => {
    const salida = calcular({
      indicadores: {
        ...indicadoresSanos,
        mora: [
          {
            monedaId: "cup",
            importeActual: 2000,
            importeAnterior: 1000,
            cobrosActual: 20,
            cobrosAnterior: 12,
          },
          {
            monedaId: "usd",
            importeActual: 110,
            importeAnterior: 100,
            cobrosActual: 8,
            cobrosAnterior: 7,
          },
          {
            monedaId: "eur",
            importeActual: 900,
            importeAnterior: 100,
            cobrosActual: 4,
            cobrosAnterior: 2,
          },
        ],
      },
    });

    // cup dispara; usd sube solo un 10 %; eur se queda sin muestra suficiente.
    expect(salida.alertas.map((alerta) => alerta.monedaId)).toEqual(["cup"]);
    expect(salida.alertas[0]).toMatchObject({
      id: "mora-aumento:cup",
      familia: "mora",
      severidad: "peligro",
      comparacion: { metrica: "recargoMora", variacionPorcentual: 100 },
      destino: null,
    });
  });

  it("mide la cartera del entrenador contra el corte anterior", () => {
    const salida = calcular({
      entrenadores: [
        entrenador({ id: "sube", carteraActiva: 14, carteraActivaAnterior: 10 }),
        entrenador({
          id: "cae",
          nombre: "Ana",
          carteraActiva: 6,
          carteraActivaAnterior: 10,
          perdidos: 4,
        }),
        entrenador({ id: "chico", carteraActiva: 1, carteraActivaAnterior: 4 }),
      ],
    });

    expect(salida.alertas).toHaveLength(1);
    expect(salida.alertas[0]).toMatchObject({
      id: "entrenador-cartera-caida:cae",
      severidad: "peligro",
      titulo: "La cartera de Ana se reduce",
      destino: { tipo: "entrenador", id: "cae" },
    });
    expect(salida.alertas[0]?.detalle).toContain("Perdió 4");
  });

  it("recorta cada familia y cuenta lo que deja fuera", () => {
    const salida = calcular({
      planes: Array.from({ length: 5 }, (_, indice) =>
        plan({
          id: `p${indice}`,
          vendidos: indice,
          vendidosAnterior: 20,
        })),
    });

    expect(salida.alertas).toHaveLength(UMBRALES_ALERTA.porFamilia);
    expect(salida.omitidas).toBe(5 - UMBRALES_ALERTA.porFamilia);
    // Los más graves sobreviven al recorte: p0 perdió el 100 %.
    expect(salida.alertas[0]?.id).toBe("plan-contratacion-caida:p0");
  });

  it("ordena por gravedad y luego por magnitud", () => {
    const salida = calcular({
      indicadores: {
        ...indicadoresSanos,
        visitas: { actual: 80, anterior: 100 },
      },
      entrenadores: [
        entrenador({ id: "grave", carteraActiva: 2, carteraActivaAnterior: 10 }),
      ],
    });

    expect(salida.alertas.map((alerta) => alerta.severidad)).toEqual([
      "peligro",
      "aviso",
    ]);
  });

  it("declara el hueco de datos con su denominador y sin destino inventado", () => {
    const salida = calcular({
      resumen: {
        ...resumenSano,
        sinFechaNacimiento: 30,
        porSexo: [
          { etiqueta: "M", total: 40 },
          { etiqueta: "Masculino", total: 30 },
          { etiqueta: "F", total: 25 },
          { etiqueta: "SIN DATO", total: 5 },
        ],
      },
    });

    expect(salida.alertas.map((alerta) => alerta.id)).toEqual([
      "datos-fecha-nacimiento",
      "datos-sexo",
    ]);
    expect(salida.alertas[0]).toMatchObject({
      severidad: "peligro",
      muestra: { valor: 70, base: 100 },
      comparacion: null,
      destino: null,
    });
    expect(salida.alertas[1]?.titulo).toBe(
      "El sexo está escrito de varias formas",
    );
  });

  it("no divide por cero con el padrón vacío", () => {
    expect(
      calcular({
        resumen: {
          sociosRegistrados: 0,
          sociosActivos: 0,
          sociosConCobertura: 0,
          menores18: 0,
          sinFechaNacimiento: 0,
          porSexo: [],
        },
      }).alertas,
    ).toEqual([]);
  });
});
