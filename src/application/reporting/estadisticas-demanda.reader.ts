/**
 * Mapa de demanda día × hora (docs/PLAN_ESTADISTICAS.md §5.2, fase E3-b).
 *
 * Lo que se mide es **demanda observada**: cuánta gente entró, qué día de la
 * semana y a qué hora local de la sede. No es ocupación y no puede serlo: un
 * porcentaje de ocupación necesita aforo por sede o por franja, que el sistema
 * todavía no modela (§7). Enseñar «85 % de ocupación» sin capacidad sería un
 * número inventado, y el plan lo prohíbe explícitamente.
 *
 * La proyección de cada instante a la hora local se hace **instante a
 * instante** con `Gym.timezone`: un desplazamiento fijo convertiría en falsa
 * toda la historia anterior al último cambio de horario de verano. La trampa ya
 * costó una lectura de «Madrugada 69 / Mañana 2» con la sede en
 * `America/Los_Angeles`.
 */

/** Una celda del mapa: un día de la semana a una hora concreta. */
export interface CeldaDemanda {
  /** 0 = domingo, como `calendarioLocal`. */
  diaSemana: number;
  /** Hora local de la sede, 0–23. */
  hora: number;
  visitas: number;
  /** Socios distintos que entraron en esa celda dentro del período. */
  socios: number;
}

/**
 * Franja declarada frente a franja observada de un socio (regla 9).
 *
 * Son dos cosas distintas y nunca se enseña una con el nombre de la otra:
 * `declarada` es la preferencia que hay escrita en su ficha y `observada` sale
 * de sus entradas reales. La discrepancia es justo el dato útil.
 */
export interface FranjaSocio {
  ci: string;
  nombre: string;
  /** Nombre del horario elegido en la ficha; `null` si no declaró ninguno. */
  horarioNombre: string | null;
  /** Hora de inicio del horario declarado; `null` si no declaró. */
  horarioHoraInicio: number | null;
  /** Franja con más visitas del socio en el período; `null` si no vino. */
  franjaObservada: string | null;
  visitas: number;
}

export interface LecturaDemanda {
  celdas: CeldaDemanda[];
  visitas: number;
  /** Socios distintos que entraron alguna vez en el período. */
  socios: number;
  /** Entradas cuyo instante no se pudo leer. Se declaran, no se reparten. */
  sinInstante: number;
  /** Entradas sin salida registrada dentro del período. */
  abiertas: number;
  /** El lector llegó a su tope de filas y la lectura está incompleta. */
  truncado: boolean;
  franjaPorSocio: FranjaSocio[];
}

export interface EstadisticasDemandaReader {
  leerDemanda(input: {
    gymId: string;
    zona: string;
    desde: Date;
    hastaExclusiva: Date;
  }): Promise<LecturaDemanda>;
}
