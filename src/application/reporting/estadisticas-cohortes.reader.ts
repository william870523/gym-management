/**
 * Cohortes de alta (docs/PLAN_ESTADISTICAS.md §4.3, fase E3-b).
 *
 * La pregunta es distinta a la que ya responde el panel de retención. Aquél
 * agrupa por **cuándo vencía** un contrato; éste agrupa por **cuándo entró** el
 * socio y mira hacia adelante: de los que se dieron de alta en marzo, ¿cuántos
 * seguían a los 30, 60 y 90 días?
 *
 * Tres decisiones sostienen el módulo:
 *
 * 1. **La supervivencia no se decide aquí.** Quién causó salida y qué día lo
 *    hizo lo dice el motor canónico de retención (`domain/retention/`), el mismo
 *    que alimenta Control y Calidad. Este módulo solo pregunta «¿este socio
 *    tenía salida consumada antes del día alta+N?». La regla 11 del plan prohíbe
 *    una segunda fórmula de renovación, y una cohorte que decidiera por su
 *    cuenta quién se fue sería exactamente eso.
 * 2. **El alta sí es nuestra.** Cuándo entró un socio no es una clasificación de
 *    retención: es el primer contrato de origen `ALTA` de toda su historia
 *    (§3.3). Eso se lee de la base, y por eso hay dos puertos y no uno.
 * 3. **Un horizonte que aún no ha podido cerrarse no vale cero.** Si el motor
 *    todavía no ha podido decidir lo que pasó en la ventana [alta, alta+N], la
 *    cohorte declara ese horizonte **abierto**, no retenido al 100 % ni
 *    perdido (regla 5).
 */

/** Los tres cortes que pide el plan. No se configuran desde el cliente. */
export const HORIZONTES_COHORTE = [30, 60, 90] as const;
export type HorizonteCohorte = (typeof HORIZONTES_COHORTE)[number];

export const GRANULARIDADES_COHORTE = ["semana", "mes"] as const;
export type GranularidadCohorte = (typeof GRANULARIDADES_COHORTE)[number];

/** Un socio y el día en que entró. */
export interface AltaCohorte {
  ci: string;
  nombre: string;
  /** Día canónico del alta, `YYYY-MM-DD`. Las fechas de contrato son 00:00Z. */
  dia: string;
}

/**
 * Lo que el motor canónico ya decidió sobre un socio.
 *
 * Los dos campos son **fechas decididas**, no eventos que haya que interpretar:
 * `diaPrimeraSalida` es el `exit_date` del motor —el primer día en que dejó de
 * ser socio, ya descontada la gracia— y `diaPrimeraRenovacion` la fecha efectiva
 * de la primera renovación que el motor reconoció con evidencia.
 */
export interface HistoriaCanonicaSocio {
  ci: string;
  diaPrimeraSalida: string | null;
  diaPrimeraRenovacion: string | null;
}

export interface HistoriaCanonica {
  socios: HistoriaCanonicaSocio[];
  /**
   * Hasta este día las decisiones del motor están cerradas. Más allá hay
   * oportunidades todavía dentro de su gracia, que aún pueden renovar: contarlas
   * como bajas sería inventar una salida que no ha ocurrido.
   */
  corteMadurez: string;
  diasGracia: number;
  /** Advertencias que publica el propio motor; se muestran tal cual. */
  advertencias: string[];
}

/**
 * Puerto de **lectura** del motor canónico para las cohortes.
 *
 * Igual que `RetencionCanonicaReader` en el cruzador: la implementación no
 * clasifica, traduce. Si la cohorte y Control y Calidad discreparan alguna vez,
 * el defecto estaría en la traducción, nunca en dos fórmulas rivales.
 */
export interface RetencionHistoriaReader {
  leerHistoria(input: {
    gymId: string;
    desde: Date;
    hasta: Date;
  }): Promise<HistoriaCanonica>;
}

export interface EstadisticasCohortesReader {
  /**
   * Primera alta de cada socio —la de toda su historia, no la del período— y
   * solo las que caen dentro de la ventana consultada. Un socio que entró hace
   * dos años y renovó ayer no pertenece a la cohorte de ayer.
   */
  leerAltas(input: {
    gymId: string;
    desde: Date;
    hastaExclusiva: Date;
  }): Promise<AltaCohorte[]>;

  /**
   * Socios vivos sin ninguna membresía de origen `ALTA`. No tienen cohorte
   * posible y se declaran como hueco de cobertura, en vez de repartirse.
   */
  contarSociosSinAlta(gymId: string): Promise<number>;
}
