import type {
  EstadisticasPronosticoReader,
  VisitasPorDia,
} from "./estadisticas-pronostico.reader";

const DIA_MS = 86_400_000;
const MUESTRAS_MINIMAS_POR_DIA = 8;
export const HISTORIAS_PRONOSTICO = [90, 180, 365] as const;
export const HORIZONTES_PRONOSTICO = [7, 28] as const;

export class ConsultaPronosticoInvalida extends Error {}

const DIAS = [
  "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado",
] as const;

function inicioUtc(fecha: Date) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
}
function sumarDias(fecha: Date, dias: number) {
  return new Date(fecha.getTime() + dias * DIA_MS);
}
function aDia(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}
function redondear(valor: number) {
  return Math.round(valor * 100) / 100;
}

/** Percentil lineal R-7, escrito aquí para que el método sea auditable. */
export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const posicion = (ordenados.length - 1) * p;
  const inferior = Math.floor(posicion);
  const superior = Math.ceil(posicion);
  if (inferior === superior) return ordenados[inferior]!;
  const peso = posicion - inferior;
  return ordenados[inferior]! * (1 - peso) + ordenados[superior]! * peso;
}

function serieCompleta(desde: Date, hastaExclusivo: Date, observadas: VisitasPorDia[]) {
  const porDia = new Map(observadas.map((fila) => [fila.dia, fila.visitas]));
  const salida: VisitasPorDia[] = [];
  for (let fecha = desde; fecha < hastaExclusivo; fecha = sumarDias(fecha, 1)) {
    const dia = aDia(fecha);
    salida.push({ dia, visitas: porDia.get(dia) ?? 0 });
  }
  return salida;
}

export class EstadisticasPronosticoService {
  constructor(private readonly reader: EstadisticasPronosticoReader) {}

  async pronostico(input: {
    gymId: string;
    zona: string;
    hoy: Date;
    diasHistoria: number;
    diasHorizonte: number;
  }) {
    if (!HISTORIAS_PRONOSTICO.includes(input.diasHistoria as any)) {
      throw new ConsultaPronosticoInvalida("La historia debe ser de 90, 180 o 365 días.");
    }
    if (!HORIZONTES_PRONOSTICO.includes(input.diasHorizonte as any)) {
      throw new ConsultaPronosticoInvalida("El horizonte debe ser de 7 o 28 días.");
    }

    const hoy = inicioUtc(input.hoy);
    const desdeSolicitado = sumarDias(hoy, -input.diasHistoria);
    const lectura = await this.reader.leerVisitasDiarias({
      gymId: input.gymId,
      zona: input.zona,
      desdeDia: desdeSolicitado,
      hastaDiaExclusivo: hoy,
    });
    const primera = lectura.primeraEntradaDia === null
      ? null
      : new Date(`${lectura.primeraEntradaDia}T00:00:00.000Z`);
    const desdeEfectivo = primera === null || primera < desdeSolicitado
      ? desdeSolicitado
      : primera;
    const historica = serieCompleta(desdeEfectivo, hoy, lectura.visitasPorDia);
    const porDiaSemana = Array.from({ length: 7 }, (_, diaSemana) => {
      const valores = historica
        .filter((fila) => new Date(`${fila.dia}T00:00:00.000Z`).getUTCDay() === diaSemana)
        .map((fila) => fila.visitas);
      return {
        diaSemana,
        etiqueta: DIAS[diaSemana],
        muestras: valores.length,
        inferior: redondear(percentil(valores, 0.10)),
        central: redondear(percentil(valores, 0.50)),
        superior: redondear(percentil(valores, 0.90)),
      };
    });
    const muestrasMinimas = Math.min(...porDiaSemana.map((fila) => fila.muestras));
    const disponible = !lectura.truncado && muestrasMinimas >= MUESTRAS_MINIMAS_POR_DIA;
    const proyeccionDiaria = disponible
      ? Array.from({ length: input.diasHorizonte }, (_, indice) => {
        const fecha = sumarDias(hoy, indice + 1);
        const referencia = porDiaSemana[fecha.getUTCDay()]!;
        return {
          dia: aDia(fecha),
          diaSemana: referencia.diaSemana,
          etiqueta: referencia.etiqueta,
          inferior: referencia.inferior,
          central: referencia.central,
          superior: referencia.superior,
        };
      })
      : [];
    const semanas = Array.from({ length: Math.ceil(proyeccionDiaria.length / 7) }, (_, indice) => {
      const dias = proyeccionDiaria.slice(indice * 7, indice * 7 + 7);
      return {
        semana: indice + 1,
        desde: dias[0]?.dia ?? null,
        hasta: dias[dias.length - 1]?.dia ?? null,
        inferior: redondear(dias.reduce((suma, dia) => suma + dia.inferior, 0)),
        central: redondear(dias.reduce((suma, dia) => suma + dia.central, 0)),
        superior: redondear(dias.reduce((suma, dia) => suma + dia.superior, 0)),
      };
    });
    const ultimos28 = historica.slice(-28);
    const anteriores28 = historica.slice(-56, -28);
    const totalUltimos = ultimos28.reduce((suma, fila) => suma + fila.visitas, 0);
    const totalAnteriores = anteriores28.reduce((suma, fila) => suma + fila.visitas, 0);
    const variacion = totalAnteriores === 0
      ? null
      : redondear(((totalUltimos - totalAnteriores) / totalAnteriores) * 100);
    const tendencia = variacion === null
      ? "SIN_BASE"
      : variacion >= 10
      ? "SUBE"
      : variacion <= -10
      ? "BAJA"
      : "ESTABLE";
    return {
      zona: input.zona,
      dia_negocio: aDia(hoy),
      medida: "demanda observada",
      unidad: "visitas",
      disponible,
      motivoNoDisponible: disponible
        ? null
        : lectura.truncado
        ? "La lectura alcanzó el tope de filas y no es segura para pronosticar."
        : `Se necesitan al menos ${MUESTRAS_MINIMAS_POR_DIA} observaciones completas de cada día de la semana.`,
      historia: {
        diasSolicitados: input.diasHistoria,
        desde: historica[0]?.dia ?? aDia(desdeSolicitado),
        hasta: aDia(sumarDias(hoy, -1)),
        diasUtiles: historica.length,
        primeraEntrada: lectura.primeraEntradaDia,
        muestrasMinimasPorDiaSemana: muestrasMinimas,
        truncado: lectura.truncado,
      },
      horizonte: {
        dias: input.diasHorizonte,
        desde: aDia(sumarDias(hoy, 1)),
        hasta: aDia(sumarDias(hoy, input.diasHorizonte)),
      },
      metodo: {
        nombre: "Mediana estacional por día de semana",
        estimacion: "Mediana histórica del mismo día de la semana.",
        intervalo: "Banda empírica central 80 %: percentiles 10 y 90 del mismo día de la semana.",
        minimo: `${MUESTRAS_MINIMAS_POR_DIA} observaciones completas por día de la semana.`,
        garantia: "No es IA, presupuesto, aforo ni garantía. Es una referencia basada únicamente en entradas observadas.",
      },
      tendenciaReciente: {
        actual28Dias: totalUltimos,
        anterior28Dias: totalAnteriores,
        variacionPorcentual: variacion,
        estado: tendencia,
        regla: "SUBE desde +10 %, BAJA desde -10 %; entre ambos se declara ESTABLE.",
      },
      porDiaSemana,
      proyeccionDiaria,
      proyeccionSemanal: semanas,
      totalHorizonte: disponible
        ? {
          inferior: redondear(proyeccionDiaria.reduce((s, d) => s + d.inferior, 0)),
          central: redondear(proyeccionDiaria.reduce((s, d) => s + d.central, 0)),
          superior: redondear(proyeccionDiaria.reduce((s, d) => s + d.superior, 0)),
        }
        : null,
      historiaReciente: historica.slice(-28),
      advertencias: [
        "Demanda observada no significa ocupación: el sistema no modela aforo.",
        "La banda resume la dispersión histórica de cada día de semana; no es un compromiso ni una probabilidad garantizada.",
        ...(lectura.truncado ? ["La lectura está truncada; el pronóstico se deshabilitó."] : []),
      ],
    };
  }
}
