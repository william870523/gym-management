/**
 * Lecturas agregadas de la portada comparativa R6.
 *
 * Este contrato evita que Flutter reconstruya indicadores descargando todos
 * los perfiles uno por uno. Cada implementación agrupa en su propia base y el
 * servicio conserva una sola semántica para SQLite y MariaDB.
 */

export interface ResumenRankings {
  sociosRegistrados: number;
  sociosActivos: number;
  sociosConCobertura: number;
  menores18: number;
  sinFechaNacimiento: number;
  porSexo: Array<{ etiqueta: string; total: number }>;
}

export interface ComparacionMetrica {
  metrica: string;
  actual: number;
  anterior: number;
  delta: number;
  variacionPorcentual: number | null;
}

/**
 * Constructor único de la comparación contra el bloque anterior.
 *
 * Vive junto al tipo a propósito: la portada, el explorador, el CSV y las
 * alertas tienen que contar la misma variación. Un `anterior` de cero no
 * produce un porcentaje infinito ni un cero engañoso, sino `null`, que la
 * vista declara como «sin base».
 */
export function compararMetrica(
  metrica: string,
  actual: number,
  anterior: number,
): ComparacionMetrica {
  const delta = actual - anterior;
  return {
    metrica,
    actual,
    anterior,
    delta,
    variacionPorcentual: anterior === 0
      ? null
      : Math.round((delta / anterior) * 10_000) / 100,
  };
}

export interface RankingPlan {
  id: string;
  nombre: string;
  vendidos: number;
  sociosConCobertura: number;
  renovaciones: number;
  vendidosAnterior: number;
  comparacion?: ComparacionMetrica;
}

export interface RankingEntrenador {
  id: string;
  nombre: string;
  carteraActiva: number;
  ganados: number;
  perdidos: number;
  carteraActivaAnterior: number;
  comparacion?: ComparacionMetrica;
}

export interface RankingAsistenciaSocio {
  ci: string;
  nombre: string;
  visitas: number;
  ultimaVisita: Date | null;
  fechaInicio: Date;
  visitasAnterior: number;
  ultimaVisitaAnterior: Date | null;
  comparacion?: ComparacionMetrica;
}

export interface RankingCambioEntrenador {
  ci: string;
  nombre: string;
  cambios: number;
  cambiosAnterior: number;
  comparacion?: ComparacionMetrica;
}

export interface RankingValorSocio {
  ci: string;
  nombre: string;
  monedaId: string;
  total: number;
  totalAnterior: number;
  comparacion?: ComparacionMetrica;
}

/**
 * Series que solo consumen las alertas (§5.1).
 *
 * Planes y entrenadores no aparecen aquí: las alertas leen las mismas filas
 * que la portada, pero sin recortar a los cinco primeros. Un entrenador cuya
 * cartera se hunde deja de estar, justamente, entre los cinco mayores.
 */
export interface MoraPorMoneda {
  monedaId: string;
  importeActual: number;
  importeAnterior: number;
  cobrosActual: number;
  cobrosAnterior: number;
}

export interface IndicadoresAlerta {
  visitas: { actual: number; anterior: number };
  mora: MoraPorMoneda[];
}

export const TIPOS_RANKING = [
  "planes",
  "entrenadores",
  "socios-visitas",
  "socios-inactividad",
  "socios-cambios-entrenador",
  "socios-valor",
] as const;

export type TipoRanking = (typeof TIPOS_RANKING)[number];
export type DireccionRanking = "asc" | "desc";

export type OrdenRanking =
  | "nombre"
  | "vendidos"
  | "sociosConCobertura"
  | "renovaciones"
  | "carteraActiva"
  | "ganados"
  | "perdidos"
  | "visitas"
  | "diasSinVisita"
  | "cambios"
  | "total";

export interface ConsultaRanking {
  gymId: string;
  tipo: TipoRanking;
  desde: Date;
  hastaExclusiva: Date;
  hoy: Date;
  desdeAnterior: Date;
  hastaAnteriorExclusiva: Date;
  hoyAnterior: Date;
  busqueda: string;
  orden: OrdenRanking;
  direccion: DireccionRanking;
  monedaId: string | null;
  limite: number;
  offset: number;
}

export type FilaRanking =
  | RankingPlan
  | RankingEntrenador
  | RankingAsistenciaSocio
  | RankingCambioEntrenador
  | RankingValorSocio;

export interface ResultadoRanking {
  total: number;
  filas: FilaRanking[];
}

export interface EstadisticasRankingsReader {
  leerResumen(gymId: string, hoy: Date): Promise<ResumenRankings>;

  /**
   * Indicadores agregados del gimnasio que no salen de ningún ranking:
   * asistencia total y recargo de mora cobrado, cada uno con su bloque
   * anterior. Las monedas nunca se suman entre sí.
   */
  leerIndicadoresAlerta(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
  ): Promise<IndicadoresAlerta>;

  /** `limite` en `null` devuelve el catálogo completo, sin recorte. */
  leerPlanes(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    hoy: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    hoyAnterior: Date,
    limite: number | null,
  ): Promise<RankingPlan[]>;

  /** `limite` en `null` devuelve el catálogo completo, sin recorte. */
  leerEntrenadores(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    hoy: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    hoyAnterior: Date,
    limite: number | null,
  ): Promise<RankingEntrenador[]>;

  leerSociosPorVisitas(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    limite: number,
  ): Promise<RankingAsistenciaSocio[]>;

  leerSociosPorInactividad(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    limite: number,
  ): Promise<RankingAsistenciaSocio[]>;

  leerCambiosEntrenador(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    limite: number,
  ): Promise<RankingCambioEntrenador[]>;

  leerValorSocios(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    limite: number,
  ): Promise<RankingValorSocio[]>;

  leerRanking(consulta: ConsultaRanking): Promise<ResultadoRanking>;
}
