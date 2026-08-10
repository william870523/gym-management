import {
  GRANULARIDADES_COHORTE,
  HORIZONTES_COHORTE,
  type AltaCohorte,
  type EstadisticasCohortesReader,
  type GranularidadCohorte,
  type HistoriaCanonicaSocio,
  type HorizonteCohorte,
  type RetencionHistoriaReader,
} from "./estadisticas-cohortes.reader";

const DIA_MS = 86_400_000;

export const PERIODOS_COHORTES = [30, 90, 365] as const;
export type PeriodoCohortes = (typeof PERIODOS_COHORTES)[number];

/** Por debajo de esto una tasa no se lee como tendencia (regla 7 del plan). */
export const MUESTRA_MINIMA_COHORTE = 5;

export class ConsultaCohortesInvalida extends Error {}

const MESES_CORTOS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
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

function sumarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00.000Z`) + dias * DIA_MS)
    .toISOString()
    .slice(0, 10);
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round(
    (Date.parse(`${hasta}T00:00:00.000Z`) - Date.parse(`${desde}T00:00:00.000Z`))
      / DIA_MS,
  );
}

/**
 * Semana ISO del día. Se calcula sobre el día de calendario ya resuelto —una
 * cadena `YYYY-MM-DD`—, así que no vuelve a interpretar ningún instante ni
 * arrastra la zona del proceso.
 */
export function semanaIso(dia: string): { clave: string; inicio: string } {
  const fecha = new Date(Date.parse(`${dia}T00:00:00.000Z`));
  const desdeLunes = (fecha.getUTCDay() + 6) % 7;
  const lunes = new Date(fecha.getTime() - desdeLunes * DIA_MS);
  // El año de una semana ISO es el del jueves que contiene: por eso el 31 de
  // diciembre puede pertenecer a la semana 1 del año siguiente.
  const jueves = new Date(lunes.getTime() + 3 * DIA_MS);
  const anio = jueves.getUTCFullYear();
  const cuatroEnero = new Date(Date.UTC(anio, 0, 4));
  const lunesSemanaUno = new Date(
    cuatroEnero.getTime() - ((cuatroEnero.getUTCDay() + 6) % 7) * DIA_MS,
  );
  const numero = 1
    + Math.round((lunes.getTime() - lunesSemanaUno.getTime()) / (7 * DIA_MS));
  return {
    clave: `${anio}-W${String(numero).padStart(2, "0")}`,
    inicio: lunes.toISOString().slice(0, 10),
  };
}

interface Grupo {
  clave: string;
  etiqueta: string;
  inicio: string;
  fin: string;
  altas: AltaCohorte[];
}

function agrupar(
  altas: AltaCohorte[],
  granularidad: GranularidadCohorte,
): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const alta of altas) {
    const { clave, inicio, etiqueta, fin } = granularidad === "mes"
      ? mesDe(alta.dia)
      : semanaDe(alta.dia);
    const grupo = grupos.get(clave);
    if (grupo) grupo.altas.push(alta);
    else grupos.set(clave, { clave, etiqueta, inicio, fin, altas: [alta] });
  }
  return [...grupos.values()].sort((a, b) => a.inicio.localeCompare(b.inicio));
}

function mesDe(dia: string) {
  const clave = dia.slice(0, 7);
  const anio = Number(clave.slice(0, 4));
  const mes = Number(clave.slice(5, 7));
  const inicio = `${clave}-01`;
  const fin = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  return {
    clave,
    etiqueta: `${MESES_CORTOS[mes - 1] ?? clave} ${anio}`,
    inicio,
    fin,
  };
}

function semanaDe(dia: string) {
  const { clave, inicio } = semanaIso(dia);
  const fin = sumarDias(inicio, 6);
  const mes = Number(inicio.slice(5, 7));
  return {
    clave,
    etiqueta: `sem. ${clave.slice(6)} · ${Number(inicio.slice(8, 10))} ` +
      `${MESES_CORTOS[mes - 1] ?? ""}`.trimEnd(),
    inicio,
    fin,
  };
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  const valor = orden.length % 2 === 1
    ? orden[medio]!
    : (orden[medio - 1]! + orden[medio]!) / 2;
  return Math.round(valor * 10) / 10;
}

function porcentaje(numerador: number, denominador: number): number | null {
  return denominador === 0
    ? null
    : Math.round((numerador / denominador) * 10_000) / 100;
}

export interface HorizonteMedido {
  dias: HorizonteCohorte;
  /** Socios cuya ventana [alta, alta+N] el motor ya pudo decidir entera. */
  maduras: number;
  /** De esas, las que seguían siendo socios el día alta+N. */
  retenidas: number;
  /** De esas, las que ya habían causado salida. */
  bajas: number;
  /** Socios cuya ventana todavía no ha podido cerrarse. Ni a favor ni en contra. */
  abiertas: number;
  tasaPct: number | null;
  muestraBaja: boolean;
}

/**
 * ¿Seguía siendo socio el día `alta + N`?
 *
 * La respuesta la da el motor: si su primera salida consumada es posterior a ese
 * día —o no existe— seguía dentro. Una salida anterior al alta se ignora a
 * propósito: pertenece a una vida anterior del socio y ésta es su primera alta.
 */
function sobrevive(
  historia: HistoriaCanonicaSocio | undefined,
  diaAlta: string,
  diaCorte: string,
): boolean {
  const salida = historia?.diaPrimeraSalida ?? null;
  if (salida === null) return true;
  if (salida <= diaAlta) return true;
  return salida > diaCorte;
}

function medirHorizonte(
  altas: AltaCohorte[],
  historia: Map<string, HistoriaCanonicaSocio>,
  dias: HorizonteCohorte,
  corteMadurez: string,
): HorizonteMedido {
  let maduras = 0;
  let retenidas = 0;
  let abiertas = 0;
  for (const alta of altas) {
    const corte = sumarDias(alta.dia, dias);
    // El motor solo ha decidido lo ocurrido hasta su corte de madurez. Si la
    // ventana llega más lejos, todavía hay contratos dentro de su gracia que
    // pueden renovar: el horizonte está abierto, no perdido.
    if (corte > corteMadurez) {
      abiertas += 1;
      continue;
    }
    maduras += 1;
    if (sobrevive(historia.get(alta.ci), alta.dia, corte)) retenidas += 1;
  }
  return {
    dias,
    maduras,
    retenidas,
    bajas: maduras - retenidas,
    abiertas,
    tasaPct: porcentaje(retenidas, maduras),
    muestraBaja: maduras > 0 && maduras < MUESTRA_MINIMA_COHORTE,
  };
}

export class EstadisticasCohortesService {
  constructor(
    private readonly reader: EstadisticasCohortesReader,
    /** Sin él no hay cohorte posible: la supervivencia la decide el motor. */
    private readonly retencion?: RetencionHistoriaReader,
  ) {}

  async cohortes(input: {
    gymId: string;
    zona: string;
    hoy: Date;
    dias: number;
    granularidad: string;
  }) {
    if (!PERIODOS_COHORTES.includes(input.dias as PeriodoCohortes)) {
      throw new ConsultaCohortesInvalida(
        "El período debe ser 30, 90 o 365 días.",
      );
    }
    if (
      !GRANULARIDADES_COHORTE.includes(
        input.granularidad as GranularidadCohorte,
      )
    ) {
      throw new ConsultaCohortesInvalida(
        "La granularidad debe ser «semana» o «mes».",
      );
    }

    const granularidad = input.granularidad as GranularidadCohorte;
    const hoy = inicioUtc(input.hoy);
    const hastaExclusiva = new Date(hoy.getTime() + DIA_MS);
    const desde = new Date(hastaExclusiva.getTime() - input.dias * DIA_MS);

    const cabecera = {
      zona: input.zona,
      dia_negocio: aDia(hoy),
      periodo: {
        dias: input.dias,
        desde: aDia(desde),
        hasta: aDia(hoy),
      },
      granularidad,
      horizontes: [...HORIZONTES_COHORTE],
      definicion:
        "Cohorte de alta: los socios se agrupan por el día en que entraron —su " +
        "primer contrato de origen ALTA— y se mira si seguían siendo socios a " +
        "los 30, 60 y 90 días. Quién causó salida y qué día lo hizo lo decide " +
        "el motor canónico de retención, el mismo que alimenta Control y " +
        "Calidad; aquí no se reclasifica a nadie.",
    };

    if (!this.retencion) {
      return {
        ...cabecera,
        disponible: false as const,
        motivo:
          "Las cohortes necesitan el motor canónico de retención y esta " +
          "instalación no lo tiene conectado. Antes que una supervivencia " +
          "calculada por segunda vez, ninguna.",
        politica: null,
        cohortes: [],
        totales: null,
        cobertura: null,
        advertencias: [],
      };
    }

    const [altas, sinAlta, historia] = await Promise.all([
      this.reader.leerAltas({ gymId: input.gymId, desde, hastaExclusiva }),
      this.reader.contarSociosSinAlta(input.gymId),
      this.retencion.leerHistoria({ gymId: input.gymId, desde, hasta: hoy }),
    ]);

    const porSocio = new Map(historia.socios.map((fila) => [fila.ci, fila]));
    const grupos = agrupar(altas, granularidad);

    const cohortes = grupos.map((grupo) => {
      const horizontes = HORIZONTES_COHORTE.map((dias) =>
        medirHorizonte(grupo.altas, porSocio, dias, historia.corteMadurez)
      );
      // Tiempo hasta el abandono y hasta la primera renovación: las dos fechas
      // vienen decididas del motor. Solo se mide a quien ya vivió el hecho, y el
      // denominador viaja al lado para que no se lea como si fuera del total.
      const diasHastaBaja: number[] = [];
      const diasHastaRenovacion: number[] = [];
      for (const alta of grupo.altas) {
        const fila = porSocio.get(alta.ci);
        if (fila?.diaPrimeraSalida && fila.diaPrimeraSalida > alta.dia) {
          diasHastaBaja.push(diasEntre(alta.dia, fila.diaPrimeraSalida));
        }
        if (fila?.diaPrimeraRenovacion && fila.diaPrimeraRenovacion > alta.dia) {
          diasHastaRenovacion.push(
            diasEntre(alta.dia, fila.diaPrimeraRenovacion),
          );
        }
      }
      return {
        clave: grupo.clave,
        etiqueta: grupo.etiqueta,
        inicio: grupo.inicio,
        fin: grupo.fin,
        altas: grupo.altas.length,
        horizontes,
        primeraRenovacion: {
          socios: diasHastaRenovacion.length,
          base: grupo.altas.length,
          medianaDias: mediana(diasHastaRenovacion),
        },
        tiempoHastaBaja: {
          socios: diasHastaBaja.length,
          base: grupo.altas.length,
          medianaDias: mediana(diasHastaBaja),
        },
      };
    });

    const todas = grupos.flatMap((grupo) => grupo.altas);
    const totales = {
      altas: todas.length,
      horizontes: HORIZONTES_COHORTE.map((dias) =>
        medirHorizonte(todas, porSocio, dias, historia.corteMadurez)
      ),
    };

    return {
      ...cabecera,
      disponible: true as const,
      motivo: null,
      politica: {
        diasGracia: historia.diasGracia,
        corteMadurez: historia.corteMadurez,
      },
      cohortes,
      totales,
      cobertura: {
        altasEnPeriodo: todas.length,
        sociosSinAltaIdentificable: sinAlta,
      },
      advertencias: [
        ...historia.advertencias,
        "Un horizonte se cuenta solo cuando el motor ya pudo decidir la " +
        `ventana entera; el corte de madurez de hoy es ${historia.corteMadurez}` +
        `, con ${historia.diasGracia} día(s) de gracia.`,
        "La mediana de días hasta la baja solo mide a quien ya se fue: en las " +
        "cohortes recientes tiende a la baja porque los que aguantan todavía " +
        "no han terminado de contar.",
        ...(sinAlta > 0
          ? [
            `${sinAlta} socio(s) vivos no tienen ninguna membresía de origen ` +
            "ALTA, así que no pertenecen a ninguna cohorte. No se reparten.",
          ]
          : []),
      ],
    };
  }
}
