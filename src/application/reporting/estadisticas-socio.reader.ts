/**
 * Lecturas del perfil estadístico de un socio (docs/PLAN_ESTADISTICAS.md §3).
 *
 * El contrato vive aquí y cada base lo implementa con su SQL: SQLite guarda las
 * marcas de tiempo como enteros epoch en milisegundos y MariaDB como DATETIME.
 * El reader normaliza los instantes y proyecta cada uno con la zona de la sede;
 * el servicio deriva de esas mismas filas las series, rachas y franjas. Así no
 * pueden discrepar dos agregaciones del mismo historial.
 *
 * Reglas que las implementaciones no pueden relajar:
 *  - todo importe llega **por moneda**, nunca sumado entre divisas;
 *  - el día y la hora se agrupan en la zona del gimnasio, no en UTC ni en la
 *    del servidor;
 *  - se cuenta solo lo no borrado y lo del gimnasio indicado.
 */

export interface FilaImportePorMoneda {
  moneda_id: string;
  cobros: number;
  total: number;
  primero: Date | null;
  ultimo: Date | null;
}

export interface FilaConteoEtiqueta {
  etiqueta: string;
  total: number;
}

export interface FilaAsistenciaDia {
  /** Día de calendario en la zona del gimnasio, YYYY-MM-DD. */
  dia: string;
  /** Hora local de entrada, 0-23. */
  hora: number;
  /** Día de la semana local, 0 = domingo. */
  diaSemana: number;
  /** Minutos de permanencia netos de pausas; null si no cerró la salida. */
  minutos: number | null;
}

export interface FilaPeso {
  fecha: Date;
  peso: number;
}

export interface FilaMembresia {
  membresia_id: string;
  plan_nombre: string;
  precio: number;
  moneda_id: string;
  fecha_inicio: Date;
  fecha_fin: Date;
  estado: string;
  origen: string;
  id_entrenador: string | null;
}

export interface FilaMoraSocio {
  /** Detalles de cobro con recargo aplicado. */
  cobrosConRecargo: number;
  /** Suma de los recargos efectivamente cobrados. */
  recargoTotal: number;
  /** Días de atraso promedio de los cobros que llegaron tarde. */
  diasAtrasoPromedio: number | null;
  /** Recargos perdonados (importe que se habría cobrado). */
  condonadoTotal: number;
}

export interface EstadisticasSocioReader {
  /** Existencia y datos de identidad mínimos; null si no es del gimnasio. */
  leerSocio(
    gymId: string,
    ci: string,
  ): Promise<{
    ci: string;
    nombres: string;
    apellidos: string;
    sexo: string;
    fecha_nacimiento: Date | null;
    estatura: number | null;
    objetivo: string | null;
    categoria: string | null;
    nacionalidad_id: string | null;
    id_horarios: string | null;
    id_entrenador: string | null;
    creado: Date | null;
  } | null>;

  leerAsistencias(
    gymId: string,
    ci: string,
    zona: string,
  ): Promise<FilaAsistenciaDia[]>;

  leerCobrosPorMoneda(gymId: string, ci: string): Promise<FilaImportePorMoneda[]>;

  leerCobrosPorMedio(gymId: string, ci: string): Promise<FilaConteoEtiqueta[]>;

  leerMora(gymId: string, ci: string): Promise<FilaMoraSocio>;

  leerPesos(gymId: string, ci: string): Promise<FilaPeso[]>;

  leerMembresias(gymId: string, ci: string): Promise<FilaMembresia[]>;

  /** Días congelados por pausas, para descontarlos del aprovechamiento. */
  leerDiasPausados(gymId: string, ci: string): Promise<number>;
}

