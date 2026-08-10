/**
 * Panel de calidad de datos (docs/PLAN_ESTADISTICAS.md §5.3, fase E3-b).
 *
 * Es la superficie que dice **qué conclusiones no son confiables y por qué**.
 * No corrige nada a escondidas: enseña el hueco, lo mide con su denominador y
 * conduce al flujo donde se resuelve.
 *
 * El recuento de bajas no se calcula aquí. La regla 11 del plan reserva al motor
 * canónico de retención decidir quién causó salida, así que este módulo le
 * pregunta cuáles son y solo mira, de esas, cuáles tienen gestión y motivo
 * codificado. Contar bajas por nuestra cuenta sería la segunda fórmula que la
 * regla prohíbe.
 */

export interface LecturaCalidadSocios {
  padron: number;
  sinFechaNacimiento: number;
  sinSexo: number;
  /** Formas distintas en que aparece escrito el sexo, sin contar las vacías. */
  variantesSexo: string[];
  sinReferencia: number;
  sinHorario: number;
}

export interface LecturaCalidadMembresias {
  total: number;
  /** Contratos del mismo socio cuyas coberturas se pisan. */
  solapadas: number;
  /** `fecha_fin` anterior o igual a `fecha_inicio`: cobertura imposible. */
  fechasInvertidas: number;
  /** El plan al que apuntan ya no existe en el catálogo. */
  sinPlanResoluble: number;
}

export interface LecturaCalidadAsistencias {
  total: number;
  /** Entradas sin instante legible: no se pueden situar en ningún día. */
  sinInstante: number;
  /** Abiertas más allá del umbral: nadie entrena tantas horas seguidas. */
  abiertasAnomalas: number;
  /** Umbral usado, en horas. Viaja con la cifra para poder discutirlo. */
  umbralHorasAbierta: number;
}

export interface LecturaCalidadCobros {
  total: number;
  sinMoneda: number;
  /** Cobros sin ningún detalle: no se sabe por qué medio entró el dinero. */
  sinMedio: number;
  /** Sin cobrador atribuido (R5.6): historia anterior al corte. */
  sinCobrador: number;
}

export interface EstadisticasCalidadReader {
  leerSocios(gymId: string): Promise<LecturaCalidadSocios>;
  leerMembresias(gymId: string): Promise<LecturaCalidadMembresias>;
  leerAsistencias(gymId: string): Promise<LecturaCalidadAsistencias>;
  leerCobros(gymId: string): Promise<LecturaCalidadCobros>;

  /**
   * De las membresías que el **motor canónico** señaló como baja, cuántas no
   * tienen un motivo codificado en su última gestión. Aquí no se decide quién
   * es baja: la lista llega decidida.
   */
  contarBajasSinMotivo(
    gymId: string,
    membresiaIds: string[],
  ): Promise<number>;
}

/** Las bajas tal como las decide el motor canónico de retención. */
export interface BajasCanonicas {
  /** Identificadores de las oportunidades que causaron salida. */
  membresiaIds: string[];
  total: number;
  /** Salidas que nadie llegó a gestionar: mide el trabajo de retención. */
  sinGestion: number;
  /** Salidas cuya última gestión fue `NO_LOCALIZADO`. */
  noLocalizadas: number;
  corteMadurez: string;
}

/**
 * Puerto de **lectura** del motor canónico para la calidad. Igual que en el
 * cruzador y en las cohortes: pregunta y traduce, nunca clasifica.
 */
export interface RetencionBajasReader {
  leerBajas(input: {
    gymId: string;
    desde: Date;
    hasta: Date;
  }): Promise<BajasCanonicas>;
}
