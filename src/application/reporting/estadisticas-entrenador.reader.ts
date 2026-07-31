/**
 * Lecturas del perfil estadístico de un entrenador
 * (docs/PLAN_ESTADISTICAS.md §4.1).
 *
 * La cartera se lee de `membresia_entrenador_asignacion`, **no** de
 * `cliente.id_entrenador`. La segunda es solo la foto vigente: quien la use
 * creerá que un entrenador nunca perdió a nadie, porque los socios que se le
 * fueron ya no le apuntan. El historial de asignaciones sí conserva las
 * aperturas y los cierres, con su motivo, que es lo que permite responder
 * «cuántos clientes ha perdido».
 */

export interface FilaCarteraEntrenador {
  /** Asignaciones abiertas hoy. */
  activos: number;
  /** Socios distintos que ha atendido alguna vez. */
  historicos: number;
  /** Asignaciones cerradas, con su motivo. */
  cerradas: number;
}

export interface FilaConteo {
  etiqueta: string;
  total: number;
}

export interface FilaMovimientoMes {
  mes: string;
  altas: number;
  bajas: number;
}

export interface FilaSocioCartera {
  ci: string;
  nombre: string;
  visitas: number;
}

export interface FilaRenovacionCartera {
  renovaciones: number;
  terminadas: number;
}

export interface FilaIngresoMoneda {
  moneda_id: string;
  cobros: number;
  total: number;
}

export interface EstadisticasEntrenadorReader {
  leerEntrenador(
    gymId: string,
    id: string,
  ): Promise<{
    id: string;
    nombre: string;
    sexo: string;
    activo: boolean;
    desde: Date | null;
  } | null>;

  leerCartera(gymId: string, id: string): Promise<FilaCarteraEntrenador>;

  /** Altas y cierres de asignación por mes, en la zona de la sede. */
  leerMovimientos(
    gymId: string,
    id: string,
    zona: string,
  ): Promise<FilaMovimientoMes[]>;

  /** Motivos por los que se cerraron sus asignaciones. */
  leerMotivosCierre(gymId: string, id: string): Promise<FilaConteo[]>;

  /** Composición de la cartera activa por una dimensión del socio. */
  leerComposicion(
    gymId: string,
    id: string,
    dimension: "sexo" | "categoria" | "horario" | "plan" | "nacionalidad",
  ): Promise<FilaConteo[]>;

  /** Franjas reales de visitas ocurridas durante una asignación con él. */
  leerFranjasObservadas(
    gymId: string,
    id: string,
    zona: string,
  ): Promise<FilaConteo[]>;

  /** Socios de la cartera activa ordenados por visitas, los más constantes. */
  leerSociosPorVisitas(
    gymId: string,
    id: string,
    limite: number,
  ): Promise<FilaSocioCartera[]>;

  /**
   * Renovaciones frente a contratos terminados, en su cartera histórica.
   * `hoy` es el día de negocio de la sede: sin él no se puede saber qué
   * contratos ya terminaron, porque el estado guardado nunca dice VENCIDA.
   */
  leerRenovacion(
    gymId: string,
    id: string,
    hoy: Date,
  ): Promise<FilaRenovacionCartera>;

  /** Ingreso atribuido al entrenador, separado por moneda. */
  leerIngresos(gymId: string, id: string): Promise<FilaIngresoMoneda[]>;
}

