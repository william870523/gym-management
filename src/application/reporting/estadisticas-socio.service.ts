/**
 * Perfil estadístico de un socio (docs/PLAN_ESTADISTICAS.md §3).
 *
 * Toda la lógica que no depende del motor de base vive aquí, para que el gemelo
 * remoto la comparta y las dos APIs no puedan contestar cifras distintas a la
 * misma pregunta.
 *
 * Dos reglas del plan se aplican sin excepción:
 *  - **los importes se devuelven por moneda**, nunca sumados entre divisas;
 *  - **toda tasa lleva su denominador**, para que un 100 % sobre dos casos no se
 *    lea como un 100 % sobre doscientos.
 */
import type {
  EstadisticasSocioReader,
  FilaAsistenciaDia,
  FilaMembresia,
} from "./estadisticas-socio.reader";

export interface Tasa {
  /** Numerador: casos que cumplen. */
  casos: number;
  /** Denominador: casos considerados. 0 = no calculable. */
  base: number;
  /** Porcentaje 0-100, o null si la base es 0. */
  porcentaje: number | null;
}

export interface PerfilSocio {
  socio: {
    ci: string;
    nombre: string;
    sexo: string;
    edad: number | null;
    categoria: string | null;
    objetivo: string | null;
    antiguedadDias: number | null;
  };
  constancia: {
    visitas: number;
    visitasPorMes: Array<{ mes: string; total: number }>;
    rachaActual: number;
    rachaMaxima: number;
    diasDesdeUltima: number | null;
    permanenciaMediaMin: number | null;
    porFranja: Array<{ franja: string; total: number }>;
    porDiaSemana: Array<{ dia: string; total: number }>;
    /** Visitas ÷ días cubiertos por membresía, descontando pausas. */
    aprovechamiento: Tasa;
  };
  dinero: {
    porMoneda: Array<{
      monedaId: string;
      cobros: number;
      total: number;
      ticketMedio: number;
      primero: string | null;
      ultimo: string | null;
    }>;
    porMedio: Array<{ medio: string; total: number }>;
    mora: {
      cobrosConRecargo: number;
      recargoTotal: number;
      diasAtrasoPromedio: number | null;
      condonadoTotal: number;
      /** Puntualidad: cobros sin recargo sobre el total de cobros. */
      puntualidad: Tasa;
    };
  };
  contrato: {
    membresias: Array<{
      id: string;
      plan: string;
      precio: number;
      monedaId: string;
      desde: string;
      hasta: string;
      estado: string;
      origen: string;
    }>;
    altas: number;
    renovaciones: number;
    cambiosDePlan: number;
    reactivaciones: number;
    diasPausados: number;
    /** Renovaciones sobre oportunidades de renovar (membresías terminadas). */
    tasaRenovacion: Tasa;
    planesRecorridos: string[];
  };
  cuerpo: {
    serie: Array<{ fecha: string; peso: number }>;
    pesoInicial: number | null;
    pesoActual: number | null;
    delta: number | null;
    estaturaCm: number | null;
    imc: number | null;
  };
}

const FRANJAS: Array<{ nombre: string; desde: number; hasta: number }> = [
  { nombre: "Mañana", desde: 5, hasta: 12 },
  { nombre: "Tarde", desde: 12, hasta: 18 },
  { nombre: "Noche", desde: 18, hasta: 24 },
  { nombre: "Madrugada", desde: 0, hasta: 5 },
];

const DIAS_SEMANA = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

export function tasa(casos: number, base: number): Tasa {
  return {
    casos,
    base,
    porcentaje: base === 0 ? null : Math.round((casos * 1000) / base) / 10,
  };
}

export class EstadisticasSocioService {
  constructor(private readonly reader: EstadisticasSocioReader) {}

  async perfil(input: {
    gymId: string;
    ci: string;
    zona: string;
    /** Día de negocio de la sede, para «días desde la última visita». */
    hoy: Date;
  }): Promise<PerfilSocio | null> {
    const socio = await this.reader.leerSocio(input.gymId, input.ci);
    if (!socio) return null;

    const [
      asistencias,
      cobrosPorMoneda,
      cobrosPorMedio,
      mora,
      pesos,
      membresias,
      diasPausados,
    ] = await Promise.all([
      this.reader.leerAsistencias(input.gymId, input.ci, input.zona),
      this.reader.leerCobrosPorMoneda(input.gymId, input.ci),
      this.reader.leerCobrosPorMedio(input.gymId, input.ci),
      this.reader.leerMora(input.gymId, input.ci),
      this.reader.leerPesos(input.gymId, input.ci),
      this.reader.leerMembresias(input.gymId, input.ci),
      this.reader.leerDiasPausados(input.gymId, input.ci),
    ]);

    const dias = [...new Set(asistencias.map((a) => a.dia))].sort();
    const visitasPorMes = agruparVisitasPorMes(asistencias);
    const cobrosTotales = cobrosPorMoneda.reduce((s, c) => s + c.cobros, 0);
    const diasCubiertos = diasDeCobertura(membresias) - diasPausados;

    return {
      socio: {
        ci: socio.ci,
        nombre: `${socio.nombres} ${socio.apellidos}`.trim(),
        sexo: socio.sexo,
        edad: edadEn(socio.fecha_nacimiento, input.hoy),
        categoria: socio.categoria,
        objetivo: socio.objetivo,
        antiguedadDias: antiguedad(membresias, socio.creado, input.hoy),
      },
      constancia: {
        visitas: asistencias.length,
        visitasPorMes,
        rachaActual: rachaActual(dias, input.hoy),
        rachaMaxima: rachaMaxima(dias),
        diasDesdeUltima: diasDesdeUltima(dias, input.hoy),
        permanenciaMediaMin: permanenciaMedia(asistencias),
        porFranja: porFranja(asistencias),
        porDiaSemana: porDiaSemana(asistencias),
        aprovechamiento: tasa(
          dias.length,
          Math.max(0, Math.round(diasCubiertos)),
        ),
      },
      dinero: {
        porMoneda: cobrosPorMoneda.map((c) => ({
          monedaId: c.moneda_id,
          cobros: c.cobros,
          total: redondear(c.total),
          ticketMedio: c.cobros === 0 ? 0 : redondear(c.total / c.cobros),
          primero: c.primero ? c.primero.toISOString() : null,
          ultimo: c.ultimo ? c.ultimo.toISOString() : null,
        })),
        porMedio: cobrosPorMedio.map((m) => ({
          medio: m.etiqueta,
          total: m.total,
        })),
        mora: {
          cobrosConRecargo: mora.cobrosConRecargo,
          recargoTotal: redondear(mora.recargoTotal),
          diasAtrasoPromedio:
            mora.diasAtrasoPromedio === null
              ? null
              : Math.round(mora.diasAtrasoPromedio * 10) / 10,
          condonadoTotal: redondear(mora.condonadoTotal),
          puntualidad: tasa(
            Math.max(0, cobrosTotales - mora.cobrosConRecargo),
            cobrosTotales,
          ),
        },
      },
      contrato: contrato(membresias, diasPausados, input.hoy),
      cuerpo: cuerpo(pesos, socio.estatura),
    };
  }
}

// --- Cálculos ----------------------------------------------------------------

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function diaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function edadEn(nacimiento: Date | null, hoy: Date): number | null {
  if (!nacimiento) return null;
  let edad = hoy.getUTCFullYear() - nacimiento.getUTCFullYear();
  const cumplio =
    hoy.getUTCMonth() > nacimiento.getUTCMonth() ||
    (hoy.getUTCMonth() === nacimiento.getUTCMonth() &&
      hoy.getUTCDate() >= nacimiento.getUTCDate());
  if (!cumplio) edad -= 1;
  return edad;
}

/** Antigüedad desde la primera contratación; si no hay, desde el alta. */
function antiguedad(
  membresias: FilaMembresia[],
  creado: Date | null,
  hoy: Date,
): number | null {
  const primera = membresias[0]?.fecha_inicio ?? creado;
  if (!primera) return null;
  return Math.max(
    0,
    Math.floor((hoy.getTime() - primera.getTime()) / 86_400_000),
  );
}

/** Días cubiertos por contrato, sin contar solapes entre membresías. */
function diasDeCobertura(membresias: FilaMembresia[]): number {
  if (membresias.length === 0) return 0;
  const intervalos = membresias
    .map((m) => [m.fecha_inicio.getTime(), m.fecha_fin.getTime()] as const)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [inicio, fin] = intervalos[0]!;
  for (const [i, f] of intervalos.slice(1)) {
    if (i <= fin) {
      fin = Math.max(fin, f);
    } else {
      total += fin - inicio;
      inicio = i;
      fin = f;
    }
  }
  total += fin - inicio;
  return total / 86_400_000;
}

export function rachaMaxima(dias: string[]): number {
  if (dias.length === 0) return 0;
  let mejor = 1;
  let actual = 1;
  for (let i = 1; i < dias.length; i += 1) {
    actual = sonConsecutivos(dias[i - 1]!, dias[i]!) ? actual + 1 : 1;
    if (actual > mejor) mejor = actual;
  }
  return mejor;
}

/**
 * Racha vigente: solo cuenta si la última visita fue hoy o ayer. Contar una
 * racha que terminó hace tres semanas como «actual» sería engañar.
 */
export function rachaActual(dias: string[], hoy: Date): number {
  if (dias.length === 0) return 0;
  const ultima = dias[dias.length - 1]!;
  const hoyIso = diaIso(hoy);
  const ayerIso = diaIso(new Date(hoy.getTime() - 86_400_000));
  if (ultima !== hoyIso && ultima !== ayerIso) return 0;
  let racha = 1;
  for (let i = dias.length - 1; i > 0; i -= 1) {
    if (!sonConsecutivos(dias[i - 1]!, dias[i]!)) break;
    racha += 1;
  }
  return racha;
}

function sonConsecutivos(anterior: string, siguiente: string): boolean {
  const a = Date.parse(`${anterior}T00:00:00.000Z`);
  const b = Date.parse(`${siguiente}T00:00:00.000Z`);
  return b - a === 86_400_000;
}

export function diasDesdeUltima(dias: string[], hoy: Date): number | null {
  if (dias.length === 0) return null;
  const ultima = Date.parse(`${dias[dias.length - 1]!}T00:00:00.000Z`);
  const hoyDia = Date.parse(`${diaIso(hoy)}T00:00:00.000Z`);
  return Math.max(0, Math.round((hoyDia - ultima) / 86_400_000));
}

function permanenciaMedia(asistencias: FilaAsistenciaDia[]): number | null {
  const cerradas = asistencias.filter(
    (a) => a.minutos !== null && a.minutos > 0,
  );
  if (cerradas.length === 0) return null;
  const suma = cerradas.reduce((s, a) => s + (a.minutos ?? 0), 0);
  return Math.round(suma / cerradas.length);
}

export function franjaDe(hora: number): string {
  return (
    FRANJAS.find((f) => hora >= f.desde && hora < f.hasta)?.nombre ?? "Madrugada"
  );
}

export function agruparVisitasPorMes(
  asistencias: FilaAsistenciaDia[],
): Array<{ mes: string; total: number }> {
  const conteo = new Map<string, number>();
  for (const asistencia of asistencias) {
    const mes = asistencia.dia.slice(0, 7);
    conteo.set(mes, (conteo.get(mes) ?? 0) + 1);
  }
  return [...conteo.entries()]
    .map(([mes, total]) => ({ mes, total }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
}

function porFranja(
  asistencias: FilaAsistenciaDia[],
): Array<{ franja: string; total: number }> {
  const conteo = new Map<string, number>();
  for (const a of asistencias) {
    const franja = franjaDe(a.hora);
    conteo.set(franja, (conteo.get(franja) ?? 0) + 1);
  }
  // Se devuelven solo las franjas con visitas: una franja en cero no dice nada
  // y ocuparía sitio en la dona.
  return [...conteo.entries()]
    .map(([franja, total]) => ({ franja, total }))
    .sort((a, b) => b.total - a.total);
}

function porDiaSemana(
  asistencias: FilaAsistenciaDia[],
): Array<{ dia: string; total: number }> {
  const conteo = new Array<number>(7).fill(0);
  for (const a of asistencias) {
    if (a.diaSemana >= 0 && a.diaSemana < 7) conteo[a.diaSemana] += 1;
  }
  // Aquí sí se devuelven los siete: el gráfico compara la semana completa y un
  // día vacío es información («los domingos no viene nadie»).
  return conteo.map((total, indice) => ({ dia: DIAS_SEMANA[indice]!, total }));
}

function contrato(
  membresias: FilaMembresia[],
  diasPausados: number,
  hoy: Date,
): PerfilSocio["contrato"] {
  const cuenta = (origen: string) =>
    membresias.filter((m) => m.origen === origen).length;
  const renovaciones = cuenta("RENOVACION");
  // Oportunidad de renovar = contrato cuya cobertura ya terminó. Se decide por
  // la FECHA, no por el estado: `estado` nunca dice VENCIDA —registra el acto,
  // no la cobertura—, así que filtrarlo por estado dejaba el denominador en
  // cero y todo el mundo salía con un 100 % de renovación que no era real.
  // El contrato vigente no cuenta: todavía no ha decidido nada.
  const terminadas = membresias.filter(
    (m) =>
      m.estado === "CANCELADA" ||
      (m.fecha_fin.getTime() <= hoy.getTime() && m.estado !== "PAUSADA"),
  ).length;

  return {
    membresias: membresias.map((m) => ({
      id: m.membresia_id,
      plan: m.plan_nombre,
      precio: redondear(m.precio),
      monedaId: m.moneda_id,
      desde: diaIso(m.fecha_inicio),
      hasta: diaIso(m.fecha_fin),
      estado: m.estado,
      origen: m.origen,
    })),
    altas: cuenta("ALTA"),
    renovaciones,
    cambiosDePlan: cuenta("CAMBIO"),
    reactivaciones: cuenta("REACTIVACION"),
    diasPausados,
    // `terminadas` ya es el universo de oportunidades. Una renovación es el
    // resultado de una de esas oportunidades, no una oportunidad adicional.
    tasaRenovacion: tasa(renovaciones, terminadas),
    planesRecorridos: [...new Set(membresias.map((m) => m.plan_nombre))],
  };
}

function cuerpo(
  pesos: Array<{ fecha: Date; peso: number }>,
  estatura: number | null,
): PerfilSocio["cuerpo"] {
  const serie = pesos.map((p) => ({
    fecha: diaIso(p.fecha),
    peso: p.peso,
  }));
  const inicial = serie[0]?.peso ?? null;
  const actual = serie[serie.length - 1]?.peso ?? null;
  // La estatura se guarda en centímetros; el IMC la necesita en metros.
  const metros = estatura && estatura > 0 ? estatura / 100 : null;
  const imc =
    actual !== null && metros !== null
      ? Math.round((actual / (metros * metros)) * 10) / 10
      : null;
  return {
    serie,
    pesoInicial: inicial,
    pesoActual: actual,
    delta:
      inicial !== null && actual !== null
        ? Math.round((actual - inicial) * 10) / 10
        : null,
    estaturaCm: estatura,
    imc,
  };
}

