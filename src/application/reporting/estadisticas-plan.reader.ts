/**
 * Lecturas del perfil estadístico de un plan (docs/PLAN_ESTADISTICAS.md §4.2).
 *
 * Dos avisos que condicionan las consultas:
 *
 *  - **el estado guardado nunca dice `VENCIDA`**: registra el acto (se activó,
 *    se pausó, se canceló), no la cobertura. La vigencia se deriva comparando
 *    `fecha_fin` con el día de negocio de la sede;
 *  - **la matriz de cambio de plan** no está guardada en ningún sitio: se
 *    reconstruye emparejando cada contrato de origen `CAMBIO` con el contrato
 *    inmediatamente anterior del mismo socio.
 */

export interface FilaConteo {
  etiqueta: string;
  total: number;
}

export interface FilaEstadoPlan {
  vigentes: number;
  pendientes: number;
  pausadas: number;
  terminadas: number;
  /** Socios distintos que han pasado por el plan. */
  socios: number;
}

export interface FilaIngresoPlan {
  moneda_id: string;
  cobros: number;
  total: number;
  descuentoTotal: number;
  recargoTotal: number;
}

export interface FilaDuracionPlan {
  /** Días de cobertura contratados, del catálogo. */
  contratada: number;
  /** Días de cobertura reales medios, incluidos los desplazamientos por pausa. */
  realMedia: number | null;
}

export interface EstadisticasPlanReader {
  leerPlan(
    gymId: string,
    id: string,
  ): Promise<{
    id: string;
    nombre: string;
    importe: number;
    monedaId: string;
    duracionDias: number;
    activo: boolean;
    incluyeEntrenador: boolean;
    aceptaCuotas: boolean;
    codigo: string | null;
  } | null>;

  leerEstados(gymId: string, id: string, hoy: Date): Promise<FilaEstadoPlan>;

  leerContratacionesPorMes(
    gymId: string,
    id: string,
    zona: string,
  ): Promise<FilaConteo[]>;

  leerComposicion(
    gymId: string,
    id: string,
    dimension: "sexo" | "categoria" | "horario" | "entrenador",
    hoy: Date,
  ): Promise<FilaConteo[]>;

  /** De qué planes vienen los socios que se cambiaron A este. */
  leerVienenDe(gymId: string, id: string): Promise<FilaConteo[]>;

  /** A qué planes se fueron los socios que dejaron este. */
  leerSeVanA(gymId: string, id: string): Promise<FilaConteo[]>;

  /** Renovaciones frente a contratos ya terminados, dentro del plan. */
  leerRenovacion(
    gymId: string,
    id: string,
    hoy: Date,
  ): Promise<{ renovaciones: number; terminadas: number }>;

  leerIngresos(gymId: string, id: string): Promise<FilaIngresoPlan[]>;

  leerDuracion(gymId: string, id: string): Promise<FilaDuracionPlan>;

  /**
   * Visitas ocurridas mientras el socio estaba cubierto por este plan.
   *
   * No se atribuye a un plan toda la historia de un socio solo porque hoy lo
   * tenga contratado. La comparación usa el día local de la visita contra las
   * fechas canónicas [inicio, fin) de cada cobertura.
   */
  leerUso(
    gymId: string,
    id: string,
    zona: string,
    hoy: Date,
  ): Promise<{
    visitas: number;
    socios: number;
    porFranja: FilaConteo[];
  }>;

  /** Cuántos contratos del plan se pagaron fraccionados. */
  leerCuotas(
    gymId: string,
    id: string,
  ): Promise<{ membresiasConCuotas: number; cuotas: number }>;
}

