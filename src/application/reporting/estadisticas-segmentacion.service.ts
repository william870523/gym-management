import {
  DEFINICIONES_MEDIDA,
  DIMENSIONES,
  FAMILIA_DIMENSION,
  MEDIDAS,
  TITULOS_DIMENSION,
  type Dimension,
  type EstadisticasSegmentacionReader,
  type FuenteMedida,
  type Medida,
} from "./estadisticas-segmentacion.reader";

const DIA_MS = 86_400_000;
export const PERIODOS_SEGMENTACION = [30, 90, 365] as const;
export type PeriodoSegmentacion = (typeof PERIODOS_SEGMENTACION)[number];

/** Por debajo de esto una tasa no se lee como tendencia (regla 7). */
export const MUESTRA_MINIMA = 5;

const MAX_FILAS_EXPORTACION = 100_000;

export class ConsultaSegmentacionInvalida extends Error {}

/**
 * Redondeo común a los dos motores.
 *
 * SQLite suma `REAL` y MariaDB `DECIMAL`, así que el mismo ingreso salía
 * `314442` de un lado y `314442.00000000006` del otro. Es ruido de coma
 * flotante, pero un informe de paridad que compara dos cifras de dinero no
 * puede depender de con qué motor se leyó. Se redondea aquí, en la única pieza
 * que comparten.
 */
function redondear(valor: number) {
  const salida = Math.round(valor * 100) / 100;
  return Object.is(salida, -0) ? 0 : salida;
}

function inicioUtc(fecha: Date) {
  return new Date(Date.UTC(
    fecha.getUTCFullYear(),
    fecha.getUTCMonth(),
    fecha.getUTCDate(),
  ));
}

/**
 * Qué se puede cruzar con qué, y por qué no lo demás.
 *
 * La regla es de alcance, no una lista a mano: un hecho solo puede agruparse por
 * una dimensión a la que pueda llegar. Todos los hechos se unen al socio, así
 * que las dimensiones del socio valen siempre; el medio de pago, en cambio,
 * vive en el detalle del cobro y no existe para una visita.
 *
 * Devuelve la fuente efectiva —`ingreso` baja al detalle cuando la dimensión
 * vive ahí— o el motivo por el que la combinación no tiene sentido.
 */
export function resolverCompatibilidad(
  dimension: Dimension,
  medida: Medida,
): { compatible: true; fuente: FuenteMedida } | {
  compatible: false;
  motivo: string;
} {
  const definicion = DEFINICIONES_MEDIDA[medida];
  const familia = FAMILIA_DIMENSION[dimension];
  const titulo = TITULOS_DIMENSION[dimension];

  if (familia === "cliente") return { compatible: true, fuente: definicion.fuente };

  // Dimensiones que solo existen en un cobro.
  if (
    definicion.fuente === "cliente" ||
    definicion.fuente === "membresia" ||
    definicion.fuente === "asistencia"
  ) {
    return {
      compatible: false,
      motivo:
        `«${definicion.titulo}» no se puede agrupar por ${titulo.toLowerCase()}: ` +
        `${titulo.toLowerCase()} es un dato del cobro y este recuento no cuenta ` +
        `cobros. Un socio no tiene medio de pago ni moneda; los tienen sus ` +
        `cobros.`,
    };
  }

  if (familia === "pago") {
    // Moneda y cobrador viven en la cabecera: alcanzables desde el cobro y
    // desde su detalle.
    return { compatible: true, fuente: definicion.fuente };
  }

  // familia === "detalle": medio de pago y cuenta.
  if (definicion.fuente === "detalle") {
    return { compatible: true, fuente: "detalle" };
  }
  if (medida === "ingreso") {
    // El importe baja al detalle, que es donde vive el medio. Se declara en la
    // definición de la medida porque cambia lo que se está sumando.
    return { compatible: true, fuente: "detalle" };
  }
  if (medida === "sociosQuePagaron") {
    return { compatible: true, fuente: "detalle" };
  }
  return {
    compatible: false,
    motivo:
      `«${definicion.titulo}» no se puede agrupar por ${titulo.toLowerCase()}: ` +
      `se calcula sobre el cobro entero y ${titulo.toLowerCase()} pertenece a ` +
      `cada movimiento del cobro. Un cobro mixto tendría dos, y el total no se ` +
      `podría repartir sin inventarlo.`,
  };
}

export class EstadisticasSegmentacionService {
  constructor(private readonly reader: EstadisticasSegmentacionReader) {}

  async cruzar(input: {
    gymId: string;
    zona: string;
    hoy: Date;
    dimension: string;
    medida: string;
    dias: number;
    monedaId?: string;
    limite?: number;
  }) {
    if (!DIMENSIONES.includes(input.dimension as Dimension)) {
      throw new ConsultaSegmentacionInvalida("La dimensión no existe.");
    }
    if (!MEDIDAS.includes(input.medida as Medida)) {
      throw new ConsultaSegmentacionInvalida("La medida no existe.");
    }
    if (!PERIODOS_SEGMENTACION.includes(input.dias as PeriodoSegmentacion)) {
      throw new ConsultaSegmentacionInvalida(
        "El período debe ser 30, 90 o 365 días.",
      );
    }

    const dimension = input.dimension as Dimension;
    const medida = input.medida as Medida;
    const definicion = DEFINICIONES_MEDIDA[medida];
    const limite = Math.min(200, Math.max(5, input.limite ?? 50));
    const monedaId = input.monedaId?.trim() || null;

    // La moneda no se mezcla nunca. Solo sobra cuando ella misma es el eje.
    if (definicion.dinero && dimension !== "moneda" && !monedaId) {
      throw new ConsultaSegmentacionInvalida(
        `«${definicion.titulo}» es dinero: hace falta moneda_id para no sumar ` +
          "monedas distintas.",
      );
    }

    const hoy = inicioUtc(input.hoy);
    const hastaExclusiva = new Date(hoy.getTime() + DIA_MS);
    const desde = new Date(hastaExclusiva.getTime() - input.dias * DIA_MS);

    const cabecera = {
      zona: input.zona,
      dia_negocio: hoy.toISOString().slice(0, 10),
      periodo: {
        dias: input.dias,
        desde: desde.toISOString().slice(0, 10),
        hasta: hoy.toISOString().slice(0, 10),
        aplica: !definicion.ignoraPeriodo,
      },
      dimension,
      dimensionTitulo: TITULOS_DIMENSION[dimension],
      medida,
      medidaTitulo: definicion.titulo,
      definicion: definicion.definicion,
      dinero: definicion.dinero,
      tasa: definicion.tasa,
      monedaId: dimension === "moneda" ? null : monedaId,
    };

    const compatibilidad = resolverCompatibilidad(dimension, medida);
    if (!compatibilidad.compatible) {
      // Vacía y explicada, nunca un cero que parezca un dato (regla 5).
      return {
        ...cabecera,
        compatible: false as const,
        motivo: compatibilidad.motivo,
        total: 0,
        filas: [],
      };
    }

    const filas = await this.reader.leerSegmentacion({
      gymId: input.gymId,
      dimension,
      medida,
      fuente: compatibilidad.fuente,
      desde,
      hastaExclusiva,
      hoy,
      monedaId: dimension === "moneda" ? null : monedaId,
      limite,
    });

    const total = redondear(
      filas.reduce((suma, fila) => suma + fila.valor, 0),
    );
    const ordenadas = [...filas]
      .sort((a, b) => b.valor - a.valor || a.etiqueta.localeCompare(b.etiqueta))
      .slice(0, limite)
      .map((fila) => ({
        ...fila,
        valor: redondear(fila.valor),
        numerador: fila.numerador === null ? null : redondear(fila.numerador),
        denominador: fila.denominador === null
          ? null
          : redondear(fila.denominador),
        // Una tasa no se reparte en porcentajes: sumar medias no da nada.
        participacion: definicion.tasa || total === 0
          ? null
          : Math.round((fila.valor / total) * 10_000) / 100,
        muestraBaja: definicion.tasa &&
          (fila.denominador ?? 0) < MUESTRA_MINIMA,
      }));

    return {
      ...cabecera,
      compatible: true as const,
      motivo: null,
      // El total de una tasa no es la suma de las tasas; se declara nulo.
      total: definicion.tasa ? null : total,
      filas: ordenadas,
    };
  }

  async exportarCsv(input: {
    gymId: string;
    zona: string;
    hoy: Date;
    dimension: string;
    medida: string;
    dias: number;
    monedaId?: string;
  }) {
    const resultado = await this.cruzar({ ...input, limite: 200 });
    if (resultado.filas.length > MAX_FILAS_EXPORTACION) {
      throw new ConsultaSegmentacionInvalida(
        `La exportación supera el máximo de ${MAX_FILAS_EXPORTACION} filas.`,
      );
    }

    const encabezados = [
      "dimension",
      "medida",
      "zona",
      "dia_negocio",
      "periodo_desde",
      "periodo_hasta",
      "periodo_aplica",
      "moneda_id",
      "compatible",
      "motivo",
      "clave",
      "etiqueta",
      "valor",
      "numerador",
      "denominador",
      "participacion_porcentual",
      "muestra_baja",
    ];
    const csvCell = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const comunes = [
      resultado.dimension,
      resultado.medida,
      resultado.zona,
      resultado.dia_negocio,
      resultado.periodo.desde,
      resultado.periodo.hasta,
      resultado.periodo.aplica ? "si" : "no",
      resultado.monedaId ?? "",
      resultado.compatible ? "si" : "no",
      resultado.motivo ?? "",
    ];
    const lineas = [
      encabezados.map(csvCell).join(","),
      ...resultado.filas.map((fila) =>
        [
          ...comunes,
          fila.clave,
          fila.etiqueta,
          fila.valor,
          fila.numerador ?? "",
          fila.denominador ?? "",
          fila.participacion ?? "",
          fila.muestraBaja ? "si" : "no",
        ].map(csvCell).join(",")
      ),
    ];
    return {
      contenido: `﻿${lineas.join("\r\n")}`,
      nombreArchivo:
        `segmentacion-${resultado.medida}-por-${resultado.dimension}-` +
        `${resultado.periodo.desde}-a-${resultado.periodo.hasta}.csv`,
      total: resultado.filas.length,
    };
  }
}
