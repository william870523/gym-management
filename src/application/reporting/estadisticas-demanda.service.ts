import { franjaDe } from "./estadisticas-socio.service";
import type {
  CeldaDemanda,
  EstadisticasDemandaReader,
  FranjaSocio,
} from "./estadisticas-demanda.reader";

const DIA_MS = 86_400_000;

export const PERIODOS_DEMANDA = [30, 90, 365] as const;
export type PeriodoDemanda = (typeof PERIODOS_DEMANDA)[number];

export class ConsultaDemandaInvalida extends Error {}

/**
 * Columnas del mapa, de lunes a domingo.
 *
 * El índice es el de `calendarioLocal` (0 = domingo); el orden es el de la
 * semana laboral, que es como se lee un gimnasio. Los siete se enseñan siempre,
 * también los vacíos: «los domingos no viene nadie» es información.
 */
export const DIAS_MAPA: Array<{ indice: number; nombre: string; corto: string }> = [
  { indice: 1, nombre: "Lunes", corto: "LUN" },
  { indice: 2, nombre: "Martes", corto: "MAR" },
  { indice: 3, nombre: "Miércoles", corto: "MIÉ" },
  { indice: 4, nombre: "Jueves", corto: "JUE" },
  { indice: 5, nombre: "Viernes", corto: "VIE" },
  { indice: 6, nombre: "Sábado", corto: "SÁB" },
  { indice: 0, nombre: "Domingo", corto: "DOM" },
];

function inicioUtc(fecha: Date) {
  return new Date(Date.UTC(
    fecha.getUTCFullYear(),
    fecha.getUTCMonth(),
    fecha.getUTCDate(),
  ));
}

function aDia(fecha: Date): string {
  return inicioUtc(fecha).toISOString().slice(0, 10);
}

function porcentaje(numerador: number, denominador: number): number | null {
  return denominador === 0
    ? null
    : Math.round((numerador / denominador) * 10_000) / 100;
}

/**
 * Recorta el mapa a las horas con actividad.
 *
 * Un gimnasio que abre de 6 a 22 no necesita ocho filas vacías arriba y dos
 * abajo: ocupan sitio y aplastan la escala de color. Se conserva una hora de
 * margen a cada lado para que el borde de la actividad se vea como borde.
 */
export function rangoHorario(
  celdas: CeldaDemanda[],
): { desde: number; hasta: number } | null {
  const conVisitas = celdas.filter((celda) => celda.visitas > 0);
  if (conVisitas.length === 0) return null;
  const horas = conVisitas.map((celda) => celda.hora);
  return {
    desde: Math.max(0, Math.min(...horas) - 1),
    hasta: Math.min(23, Math.max(...horas) + 1),
  };
}

/**
 * Cruce entre lo que el socio dijo que haría y lo que hizo (regla 9).
 *
 * Solo entran los socios que declararon franja **y** vinieron: sin las dos
 * mitades no hay nada que comparar, y contar a los que faltan como
 * «coincidentes» o «discrepantes» sería inventar. Los demás se cuentan aparte.
 */
export function compararFranjas(filas: FranjaSocio[]) {
  const comparables = filas.filter(
    (fila) => fila.horarioHoraInicio !== null && fila.franjaObservada !== null,
  );
  const coinciden = comparables.filter(
    (fila) => franjaDe(fila.horarioHoraInicio!) === fila.franjaObservada,
  );
  const discrepan = comparables
    .filter((fila) => franjaDe(fila.horarioHoraInicio!) !== fila.franjaObservada)
    .sort((a, b) => b.visitas - a.visitas || a.nombre.localeCompare(b.nombre))
    .map((fila) => ({
      ci: fila.ci,
      nombre: fila.nombre,
      declarada: franjaDe(fila.horarioHoraInicio!),
      horarioNombre: fila.horarioNombre,
      observada: fila.franjaObservada!,
      visitas: fila.visitas,
    }));

  return {
    comparables: comparables.length,
    coinciden: coinciden.length,
    coincidenciaPct: porcentaje(coinciden.length, comparables.length),
    sinDeclarar: filas.filter((fila) => fila.horarioHoraInicio === null).length,
    sinVisitas: filas.filter((fila) => fila.franjaObservada === null).length,
    discrepan,
  };
}

export class EstadisticasDemandaService {
  constructor(private readonly reader: EstadisticasDemandaReader) {}

  async demanda(input: {
    gymId: string;
    zona: string;
    hoy: Date;
    dias: number;
    /** Cuántas discrepancias declarada/observada se devuelven. */
    limiteDiscrepancias?: number;
  }) {
    if (!PERIODOS_DEMANDA.includes(input.dias as PeriodoDemanda)) {
      throw new ConsultaDemandaInvalida(
        "El período debe ser 30, 90 o 365 días.",
      );
    }
    const limite = Math.min(50, Math.max(5, input.limiteDiscrepancias ?? 12));

    const hoy = inicioUtc(input.hoy);
    const hastaExclusiva = new Date(hoy.getTime() + DIA_MS);
    const desde = new Date(hastaExclusiva.getTime() - input.dias * DIA_MS);

    const lectura = await this.reader.leerDemanda({
      gymId: input.gymId,
      zona: input.zona,
      desde,
      hastaExclusiva,
    });

    const porCelda = new Map<string, CeldaDemanda>();
    for (const celda of lectura.celdas) {
      porCelda.set(`${celda.diaSemana}|${celda.hora}`, celda);
    }

    const rango = rangoHorario(lectura.celdas);
    const horas = rango === null
      ? []
      : Array.from(
        { length: rango.hasta - rango.desde + 1 },
        (_, indice) => rango.desde + indice,
      );

    // `filas[hora][día]`, con los días en orden de semana laboral. La forma la
    // impone la vista: 24 columnas no caben en un ancho compacto, 7 sí.
    const filas = horas.map((hora) => ({
      hora,
      etiqueta: `${String(hora).padStart(2, "0")}:00`,
      celdas: DIAS_MAPA.map((dia) => {
        const celda = porCelda.get(`${dia.indice}|${hora}`);
        return {
          diaSemana: dia.indice,
          visitas: celda?.visitas ?? 0,
          socios: celda?.socios ?? 0,
        };
      }),
    }));

    const picos = [...lectura.celdas]
      .filter((celda) => celda.visitas > 0)
      .sort((a, b) =>
        b.visitas - a.visitas || a.diaSemana - b.diaSemana || a.hora - b.hora
      )
      .slice(0, 3)
      .map((celda) => ({
        diaSemana: celda.diaSemana,
        dia: DIAS_MAPA.find((dia) => dia.indice === celda.diaSemana)?.nombre
          ?? "",
        hora: celda.hora,
        etiquetaHora: `${String(celda.hora).padStart(2, "0")}:00`,
        visitas: celda.visitas,
        socios: celda.socios,
        participacionPct: porcentaje(celda.visitas, lectura.visitas),
      }));

    const porDiaSemana = DIAS_MAPA.map((dia) => {
      const visitas = lectura.celdas
        .filter((celda) => celda.diaSemana === dia.indice)
        .reduce((suma, celda) => suma + celda.visitas, 0);
      return {
        diaSemana: dia.indice,
        etiqueta: dia.nombre,
        corto: dia.corto,
        visitas,
        participacionPct: porcentaje(visitas, lectura.visitas),
      };
    });

    // Reparto por franja de las VISITAS observadas. No se mezcla con el reparto
    // de socios que declararon una franja: son unidades distintas y juntarlas en
    // una sola dona sería comparar personas con entradas.
    const franjas = new Map<string, number>();
    for (const celda of lectura.celdas) {
      const franja = franjaDe(celda.hora);
      franjas.set(franja, (franjas.get(franja) ?? 0) + celda.visitas);
    }
    const porFranjaObservada = [...franjas.entries()]
      .filter(([, visitas]) => visitas > 0)
      .map(([franja, visitas]) => ({
        franja,
        visitas,
        participacionPct: porcentaje(visitas, lectura.visitas),
      }))
      .sort((a, b) => b.visitas - a.visitas);

    const declaradas = new Map<string, number>();
    for (const fila of lectura.franjaPorSocio) {
      if (fila.horarioHoraInicio === null) continue;
      const franja = franjaDe(fila.horarioHoraInicio);
      declaradas.set(franja, (declaradas.get(franja) ?? 0) + 1);
    }
    const totalDeclarados = [...declaradas.values()].reduce(
      (suma, valor) => suma + valor,
      0,
    );
    const porFranjaDeclarada = [...declaradas.entries()]
      .map(([franja, socios]) => ({
        franja,
        socios,
        participacionPct: porcentaje(socios, totalDeclarados),
      }))
      .sort((a, b) => b.socios - a.socios);

    const comparacion = compararFranjas(lectura.franjaPorSocio);

    return {
      zona: input.zona,
      dia_negocio: aDia(hoy),
      periodo: {
        dias: input.dias,
        desde: aDia(desde),
        hasta: aDia(hoy),
      },
      // Se dice en la respuesta, no solo en la vista: quien consuma este
      // endpoint desde otro sitio tiene que leer lo mismo.
      medida: "demanda observada",
      definicion:
        "Entradas registradas, agrupadas por día de la semana y hora local de " +
        "la sede. Es demanda observada, no ocupación: un porcentaje de " +
        "ocupación exige aforo por sede o por franja, que todavía no se " +
        "modela (docs/PLAN_ESTADISTICAS.md §5.2 y §7).",
      resumen: {
        visitas: lectura.visitas,
        socios: lectura.socios,
        visitasPorSocio: lectura.socios === 0
          ? null
          : Math.round((lectura.visitas / lectura.socios) * 100) / 100,
        mediaDiaria: Math.round((lectura.visitas / input.dias) * 100) / 100,
      },
      mapa: {
        dias: DIAS_MAPA.map((dia) => ({
          diaSemana: dia.indice,
          etiqueta: dia.nombre,
          corto: dia.corto,
        })),
        horaDesde: rango?.desde ?? null,
        horaHasta: rango?.hasta ?? null,
        filas,
      },
      picos,
      porDiaSemana,
      porFranjaObservada,
      porFranjaDeclarada,
      declaradaVsObservada: {
        ...comparacion,
        discrepan: comparacion.discrepan.slice(0, limite),
        discrepanTotal: comparacion.discrepan.length,
      },
      calidad: {
        sinInstante: lectura.sinInstante,
        abiertas: lectura.abiertas,
        truncado: lectura.truncado,
      },
      advertencias: [
        "Demanda observada, no ocupación: falta el aforo por sede o franja " +
        "para poder hablar de porcentaje (§5.2).",
        "La franja declarada es la preferencia escrita en la ficha del socio; " +
        "la observada sale de sus entradas reales. Nunca se enseña una con el " +
        "nombre de la otra (regla 9).",
        ...(rango === null
          ? ["No hubo ninguna entrada en el período: el mapa queda vacío."]
          : []),
        ...(lectura.sinInstante > 0
          ? [
            `${lectura.sinInstante} entrada(s) sin instante legible quedaron ` +
            "fuera del mapa en vez de repartirse.",
          ]
          : []),
        ...(lectura.truncado
          ? [
            "La lectura alcanzó el tope de filas del período: el mapa está " +
            "incompleto y no debe leerse como total.",
          ]
          : []),
      ],
    };
  }
}
