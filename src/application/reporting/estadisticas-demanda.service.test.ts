import { describe, expect, it } from "bun:test";
import {
  compararFranjas,
  ConsultaDemandaInvalida,
  EstadisticasDemandaService,
  rangoHorario,
} from "./estadisticas-demanda.service";
import type {
  CeldaDemanda,
  EstadisticasDemandaReader,
  FranjaSocio,
  LecturaDemanda,
} from "./estadisticas-demanda.reader";

const HOY = new Date("2026-08-01T00:00:00.000Z");

class LectorFalso implements EstadisticasDemandaReader {
  constructor(private readonly lectura: Partial<LecturaDemanda>) {}

  async leerDemanda(): Promise<LecturaDemanda> {
    return {
      celdas: [],
      visitas: 0,
      socios: 0,
      sinInstante: 0,
      abiertas: 0,
      truncado: false,
      franjaPorSocio: [],
      ...this.lectura,
    };
  }
}

function celda(
  diaSemana: number,
  hora: number,
  visitas: number,
  socios = visitas,
): CeldaDemanda {
  return { diaSemana, hora, visitas, socios };
}

function socio(parcial: Partial<FranjaSocio>): FranjaSocio {
  return {
    ci: "X",
    nombre: "Socio X",
    horarioNombre: null,
    horarioHoraInicio: null,
    franjaObservada: null,
    visitas: 0,
    ...parcial,
  };
}

function consultar(lectura: Partial<LecturaDemanda>, dias = 90) {
  return new EstadisticasDemandaService(new LectorFalso(lectura)).demanda({
    gymId: "gym-1",
    zona: "America/Los_Angeles",
    hoy: HOY,
    dias,
  });
}

describe("mapa de demanda", () => {
  it("nunca habla de ocupación: declara que la medida es demanda observada", async () => {
    const resultado = await consultar({
      celdas: [celda(1, 18, 10)],
      visitas: 10,
      socios: 6,
    });
    expect(resultado.medida).toBe("demanda observada");
    expect(resultado.definicion).toContain("no ocupación");
    expect(resultado.advertencias[0]).toContain("falta el aforo");
    expect(JSON.stringify(resultado)).not.toContain("ocupacionPct");
  });

  it("coloca cada visita en su día y hora, con los siete días siempre presentes", async () => {
    const resultado = await consultar({
      celdas: [celda(1, 18, 9), celda(6, 10, 4)],
      visitas: 13,
      socios: 8,
    });
    const fila18 = resultado.mapa.filas.find((fila) => fila.hora === 18)!;
    expect(fila18.etiqueta).toBe("18:00");
    expect(fila18.celdas).toHaveLength(7);
    // El orden de columnas es semana laboral: lunes primero, domingo último.
    expect(resultado.mapa.dias.map((dia) => dia.corto)).toEqual([
      "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM",
    ]);
    expect(fila18.celdas[0]!.visitas).toBe(9);
    expect(fila18.celdas[5]!.visitas).toBe(0);
    const fila10 = resultado.mapa.filas.find((fila) => fila.hora === 10)!;
    expect(fila10.celdas[5]!.visitas).toBe(4);
  });

  it("recorta las horas muertas dejando una de margen a cada lado", () => {
    expect(rangoHorario([celda(1, 9, 3), celda(2, 20, 5)])).toEqual({
      desde: 8,
      hasta: 21,
    });
    // Sin actividad no hay rango que recortar.
    expect(rangoHorario([celda(1, 9, 0)])).toBeNull();
    // El margen no se sale del día.
    expect(rangoHorario([celda(1, 0, 1), celda(1, 23, 1)])).toEqual({
      desde: 0,
      hasta: 23,
    });
  });

  it("ordena los picos por visitas y publica su participación", async () => {
    const resultado = await consultar({
      celdas: [celda(1, 18, 20, 15), celda(3, 19, 30, 22), celda(5, 7, 10, 9)],
      visitas: 60,
      socios: 30,
    });
    expect(resultado.picos.map((pico) => [pico.dia, pico.hora, pico.visitas]))
      .toEqual([
        ["Miércoles", 19, 30],
        ["Lunes", 18, 20],
        ["Viernes", 7, 10],
      ]);
    expect(resultado.picos[0]!.participacionPct).toBe(50);
    expect(resultado.picos[0]!.etiquetaHora).toBe("19:00");
  });

  it("separa la franja declarada de la observada y no las suma", async () => {
    const resultado = await consultar({
      celdas: [celda(1, 8, 6), celda(1, 19, 14)],
      visitas: 20,
      socios: 4,
      franjaPorSocio: [
        socio({ ci: "A", horarioHoraInicio: 6, franjaObservada: "Mañana", visitas: 6 }),
        socio({ ci: "B", horarioHoraInicio: 6, franjaObservada: "Noche", visitas: 9 }),
      ],
    });
    // Una lista cuenta socios; la otra, visitas. Nunca se mezclan.
    expect(resultado.porFranjaDeclarada).toEqual([
      { franja: "Mañana", socios: 2, participacionPct: 100 },
    ]);
    expect(resultado.porFranjaObservada).toEqual([
      { franja: "Noche", visitas: 14, participacionPct: 70 },
      { franja: "Mañana", visitas: 6, participacionPct: 30 },
    ]);
  });

  it("señala a quien dice una franja y viene en otra", () => {
    const comparacion = compararFranjas([
      socio({ ci: "A", horarioHoraInicio: 7, franjaObservada: "Mañana" }),
      socio({ ci: "B", horarioHoraInicio: 7, franjaObservada: "Tarde", visitas: 11 }),
      socio({ ci: "C", horarioHoraInicio: 20, franjaObservada: "Mañana", visitas: 4 }),
      // Declaró pero no vino: no es coincidencia ni discrepancia.
      socio({ ci: "D", horarioHoraInicio: 7 }),
      // Vino pero no declaró nada.
      socio({ ci: "E", franjaObservada: "Noche", visitas: 2 }),
    ]);
    expect(comparacion.comparables).toBe(3);
    expect(comparacion.coinciden).toBe(1);
    expect(comparacion.coincidenciaPct).toBe(33.33);
    expect(comparacion.sinDeclarar).toBe(1);
    expect(comparacion.sinVisitas).toBe(1);
    expect(comparacion.discrepan.map((fila) => fila.ci)).toEqual(["B", "C"]);
    expect(comparacion.discrepan[0]).toMatchObject({
      declarada: "Mañana",
      observada: "Tarde",
    });
  });

  it("sin nadie con quien comparar no inventa un porcentaje", () => {
    expect(compararFranjas([]).coincidenciaPct).toBeNull();
    expect(
      compararFranjas([socio({ ci: "A", franjaObservada: "Tarde" })])
        .coincidenciaPct,
    ).toBeNull();
  });

  it("declara las entradas sin instante y la lectura truncada", async () => {
    const resultado = await consultar({
      celdas: [celda(2, 17, 5)],
      visitas: 5,
      socios: 3,
      sinInstante: 2,
      abiertas: 1,
      truncado: true,
    });
    expect(resultado.calidad).toEqual({
      sinInstante: 2,
      abiertas: 1,
      truncado: true,
    });
    expect(resultado.advertencias.some((a) => a.includes("2 entrada(s)"))).toBe(
      true,
    );
    expect(resultado.advertencias.some((a) => a.includes("tope de filas")))
      .toBe(true);
  });

  it("un período sin entradas deja el mapa vacío y lo dice", async () => {
    const resultado = await consultar({});
    expect(resultado.mapa.filas).toEqual([]);
    expect(resultado.mapa.horaDesde).toBeNull();
    expect(resultado.resumen.visitasPorSocio).toBeNull();
    expect(resultado.advertencias.some((a) => a.includes("ninguna entrada")))
      .toBe(true);
  });

  it("rechaza períodos que no existen", async () => {
    await expect(consultar({}, 45)).rejects.toBeInstanceOf(
      ConsultaDemandaInvalida,
    );
  });
});
