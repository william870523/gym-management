/**
 * Cruzador de segmentación (docs/PLAN_ESTADISTICAS.md §5).
 *
 * Una sola vista con dos selectores —dimensión × medida— en lugar de cuarenta
 * pantallas. Para que eso no degenere en un generador de cifras sin significado,
 * el contrato fija tres cosas:
 *
 * 1. **Cada medida nombra su hecho.** No se cuenta «socios» en abstracto: se
 *    cuenta el padrón, o las altas, o las visitas, o los cobros. Una palabra con
 *    dos significados según la dimensión es justo lo que prohíbe la regla 8.
 * 2. **Cada dimensión pertenece a algo.** El sexo es del socio; el medio de pago
 *    es del cobro. Un socio no tiene medio de pago: lo tienen sus cobros. De ahí
 *    salen las combinaciones imposibles, que se declaran vacías con su motivo en
 *    vez de devolver cero (regla 5).
 * 3. **La moneda nunca se mezcla.** Toda medida de dinero exige `moneda_id`,
 *    salvo cuando la propia moneda es la dimensión y entonces sobra.
 */

export const DIMENSIONES = [
  // Del socio: se leen de su ficha, con el valor que tiene hoy.
  "sexo",
  "nacionalidad",
  "categoria",
  "referencia",
  "horario",
  "entrenador",
  "plan",
  "estado",
  "sede",
  // Del cobro: viven en la cabecera del pago.
  "moneda",
  "cobrador",
  // Del detalle del cobro: un cobro mixto tiene dos.
  "tipo_pago",
  "cuenta",
] as const;

export type Dimension = (typeof DIMENSIONES)[number];

export const MEDIDAS = [
  "padron",
  "altas",
  "asistencias",
  "visitasPorSocio",
  "sociosQuePagaron",
  "ingreso",
  "ticketMedio",
  "descuento",
  "recargoMora",
  "diasAtrasoMedio",
  // Las dos que faltaban. No se calculan aquí: se leen del motor canónico de
  // retención (regla 11 del plan), que es quien decide qué oportunidad está
  // madura y quién causó salida.
  "bajas",
  "tasaRenovacion",
] as const;

export type Medida = (typeof MEDIDAS)[number];

/**
 * De dónde sale cada hecho. La cadena de alcance es
 * `cliente ⊂ {membresia, asistencia, pago} ⊂ detalle`: todos los hechos se unen
 * al socio, así que las dimensiones del socio valen siempre.
 */
export type FuenteMedida =
  | "cliente"
  | "membresia"
  | "asistencia"
  | "pago"
  | "detalle";

export interface DefinicionMedida {
  /** Nombre para la vista y el CSV. */
  titulo: string;
  fuente: FuenteMedida;
  /**
   * La cifra la produce el **motor canónico de retención**, no una consulta de
   * este módulo. Cambia de dónde sale el dato y con qué ejes se puede cruzar:
   * el motor desglosa por plan y por entrenador, y agrupar por cualquier otra
   * cosa exigiría reclasificar las oportunidades por nuestra cuenta, que es
   * justo lo que prohíbe la regla 11.
   */
  canonica?: boolean;
  /** El importe se agrupa por moneda y nunca se suma entre monedas. */
  dinero: boolean;
  /** Es una tasa: viaja con numerador y denominador (regla 7). */
  tasa: boolean;
  /** El padrón es un stock: no se recorta por período, y se dice. */
  ignoraPeriodo: boolean;
  /** Qué cuenta exactamente, en una frase que se enseña junto al gráfico. */
  definicion: string;
}

export const DEFINICIONES_MEDIDA: Record<Medida, DefinicionMedida> = {
  padron: {
    titulo: "Socios registrados",
    fuente: "cliente",
    dinero: false,
    tasa: false,
    ignoraPeriodo: true,
    definicion:
      "Socios vivos en el padrón. Es un stock a día de hoy, así que el período " +
      "no lo recorta.",
  },
  altas: {
    titulo: "Altas",
    fuente: "membresia",
    dinero: false,
    tasa: false,
    ignoraPeriodo: false,
    definicion:
      "Contratos de origen ALTA iniciados dentro del período. No incluye " +
      "renovaciones ni cambios de plan.",
  },
  asistencias: {
    titulo: "Asistencias",
    fuente: "asistencia",
    dinero: false,
    tasa: false,
    ignoraPeriodo: false,
    definicion: "Visitas registradas dentro del período.",
  },
  visitasPorSocio: {
    titulo: "Visitas por socio",
    fuente: "asistencia",
    dinero: false,
    tasa: true,
    ignoraPeriodo: false,
    definicion:
      "Visitas del período divididas entre los socios distintos que vinieron. " +
      "El denominador son los que vinieron, no el padrón entero.",
  },
  sociosQuePagaron: {
    titulo: "Socios que pagaron",
    fuente: "pago",
    dinero: false,
    tasa: false,
    ignoraPeriodo: false,
    definicion: "Socios distintos con al menos un cobro dentro del período.",
  },
  ingreso: {
    titulo: "Ingreso cobrado",
    fuente: "pago",
    dinero: true,
    tasa: false,
    ignoraPeriodo: false,
    definicion:
      "Importe cobrado en el período, sin cobros anulados. Agrupando por medio " +
      "de pago o cuenta sale del detalle del cobro, porque es ahí donde vive el " +
      "medio: un cobro mixto reparte su importe entre dos filas.",
  },
  ticketMedio: {
    titulo: "Ticket medio",
    fuente: "pago",
    dinero: true,
    tasa: true,
    ignoraPeriodo: false,
    definicion:
      "Importe cobrado dividido entre el número de cobros del período.",
  },
  descuento: {
    titulo: "Descuento concedido",
    fuente: "pago",
    dinero: true,
    tasa: false,
    ignoraPeriodo: false,
    definicion:
      "Suma del descuento congelado en cada cobro del período " +
      "(`descuento_monto_snapshot`).",
  },
  recargoMora: {
    titulo: "Recargo de mora cobrado",
    fuente: "detalle",
    dinero: true,
    tasa: false,
    ignoraPeriodo: false,
    definicion:
      "Suma del recargo por mora efectivamente cobrado en el período. No " +
      "incluye lo condonado.",
  },
  diasAtrasoMedio: {
    titulo: "Días medios de atraso",
    fuente: "detalle",
    dinero: false,
    tasa: true,
    ignoraPeriodo: false,
    definicion:
      "Media de días de atraso de los cobros que llevaron recargo. El " +
      "denominador son esos cobros, no todos.",
  },
  bajas: {
    titulo: "Bajas",
    fuente: "membresia",
    canonica: true,
    dinero: false,
    tasa: false,
    ignoraPeriodo: false,
    definicion:
      "Salidas del motor canónico de retención: oportunidades cuya gracia ya " +
      "terminó sin que el socio renovara. No se cuentan las que aún están " +
      "dentro de la gracia, porque todavía pueden renovar.",
  },
  tasaRenovacion: {
    titulo: "Tasa de renovación",
    fuente: "membresia",
    canonica: true,
    dinero: false,
    tasa: true,
    ignoraPeriodo: false,
    definicion:
      "Retenidos ÷ oportunidades **maduras**, las que ya agotaron su gracia. " +
      "Una renovación pendiente no cuenta ni a favor ni en contra: se queda " +
      "fuera del denominador hasta que su plazo termine.",
  },
};

/** A qué pertenece cada dimensión, que es lo que decide qué se puede cruzar. */
export const FAMILIA_DIMENSION: Record<Dimension, FuenteMedida> = {
  sexo: "cliente",
  nacionalidad: "cliente",
  categoria: "cliente",
  referencia: "cliente",
  horario: "cliente",
  entrenador: "cliente",
  plan: "cliente",
  estado: "cliente",
  sede: "cliente",
  moneda: "pago",
  cobrador: "pago",
  tipo_pago: "detalle",
  cuenta: "detalle",
};

export const TITULOS_DIMENSION: Record<Dimension, string> = {
  sexo: "Sexo",
  nacionalidad: "Nacionalidad",
  categoria: "Categoría",
  referencia: "Canal de captación",
  horario: "Franja declarada",
  entrenador: "Entrenador",
  plan: "Plan",
  estado: "Estado del socio",
  sede: "Sede",
  moneda: "Moneda",
  cobrador: "Cobrador",
  tipo_pago: "Medio de pago",
  cuenta: "Cuenta",
};

export interface ConsultaSegmentacion {
  gymId: string;
  dimension: Dimension;
  medida: Medida;
  /** Fuente efectiva: `ingreso` baja al detalle si la dimensión vive ahí. */
  fuente: FuenteMedida;
  desde: Date;
  hastaExclusiva: Date;
  hoy: Date;
  monedaId: string | null;
  limite: number;
}

export interface FilaSegmentacion {
  clave: string;
  etiqueta: string;
  valor: number;
  /** Solo en las tasas; `null` en el resto. */
  numerador: number | null;
  denominador: number | null;
}

export interface EstadisticasSegmentacionReader {
  leerSegmentacion(consulta: ConsultaSegmentacion): Promise<FilaSegmentacion[]>;
}

/** Una fila del desglose canónico de retención, tal como lo da el motor. */
export interface FilaRetencionCanonica {
  id: string;
  nombre: string;
  /** Oportunidades cuya gracia ya terminó. Es el denominador de la tasa. */
  maduras: number;
  /** De esas, las que renovaron —puntuales o dentro de la gracia—. */
  retenidas: number;
  /** De esas, las que causaron salida. */
  bajas: number;
}

/**
 * Puerto de **lectura** del motor canónico de retención.
 *
 * Se llama «lectura» a propósito: la implementación no clasifica nada, le
 * pregunta al motor que ya existe (`domain/retention/`) y traduce su respuesta.
 * Si algún día la estadística y el panel de Control y Calidad dieran cifras
 * distintas de renovación, el defecto estaría en esta traducción, nunca en dos
 * fórmulas rivales, porque solo hay una.
 */
export interface RetencionCanonicaReader {
  leerRetencion(input: {
    gymId: string;
    desde: Date;
    hasta: Date;
  }): Promise<{
    planes: FilaRetencionCanonica[];
    entrenadores: FilaRetencionCanonica[];
  }>;
}
