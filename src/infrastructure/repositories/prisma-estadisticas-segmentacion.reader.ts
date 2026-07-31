import type {
  ConsultaSegmentacion,
  Dimension,
  EstadisticasSegmentacionReader,
  FilaSegmentacion,
  FuenteMedida,
  Medida,
} from "../../application/reporting/estadisticas-segmentacion.reader";
import { prisma } from "../db/prismaClient";

/**
 * Cruzador de segmentación sobre MariaDB.
 *
 * No hay una consulta por combinación —serían más de cien—: hay **una consulta
 * componible**. El hecho pone el `FROM` y lo que se agrega; la dimensión pone
 * la expresión por la que se agrupa y el `JOIN` de su catálogo. Cruzarlos es
 * pegar las dos piezas.
 *
 * Todos los hechos se unen a `cliente`, que es lo que hace que las dimensiones
 * del socio valgan para cualquier medida sin escribir nada especial.
 *
 * El orden de los parámetros importa y sigue al del SQL: primero los de la
 * expresión de la dimensión (van en el SELECT), luego los del `FROM` y el
 * `WHERE`. Gemelo: `sqlite-estadisticas-segmentacion.reader.ts`.
 */

const SIN_DATO = "SIN DATO";

function numero(valor: unknown) {
  return Number(valor ?? 0);
}

interface PiezaDimension {
  clave: string;
  etiqueta: string;
  joins: string;
  parametros: unknown[];
}

function piezaDimension(
  dimension: Dimension,
  hoy: Date,
): PiezaDimension {
  switch (dimension) {
    case "sexo":
      return {
        clave: `COALESCE(NULLIF(TRIM(c.sexo), ''), '${SIN_DATO}')`,
        etiqueta: `COALESCE(NULLIF(TRIM(c.sexo), ''), '${SIN_DATO}')`,
        joins: "",
        parametros: [],
      };
    case "categoria":
      return {
        clave: `COALESCE(NULLIF(TRIM(c.categoria), ''), '${SIN_DATO}')`,
        etiqueta: `COALESCE(NULLIF(TRIM(c.categoria), ''), '${SIN_DATO}')`,
        joins: "",
        parametros: [],
      };
    case "nacionalidad":
      return {
        clave: `COALESCE(c.nacionalidad_id, '${SIN_DATO}')`,
        etiqueta: `COALESCE(n.nacionalidad_nombre, '${SIN_DATO}')`,
        joins:
          "LEFT JOIN nacionalidades n ON n.nacionalidad_id = c.nacionalidad_id",
        parametros: [],
      };
    case "referencia":
      return {
        clave: `COALESCE(c.referencia_id, '${SIN_DATO}')`,
        etiqueta: `COALESCE(r.nombre_referencia, '${SIN_DATO}')`,
        joins: "LEFT JOIN referencia r ON r.referencia_id = c.referencia_id",
        parametros: [],
      };
    case "horario":
      return {
        clave: `COALESCE(c.id_horarios, '${SIN_DATO}')`,
        etiqueta: `COALESCE(h.nombre_horario, '${SIN_DATO}')`,
        joins: "LEFT JOIN horario h ON h.horario_id = c.id_horarios",
        parametros: [],
      };
    case "entrenador":
      return {
        clave: `COALESCE(c.id_entrenador, '${SIN_DATO}')`,
        etiqueta:
          `COALESCE(CONCAT(e.nombres_entrenador, ' ', e.apellidos_entrenador), ` +
          `'${SIN_DATO}')`,
        joins: "LEFT JOIN entrenadores e ON e.id_entrenador = c.id_entrenador",
        parametros: [],
      };
    case "plan":
      return {
        clave: `COALESCE(c.id_planes_pago, '${SIN_DATO}')`,
        etiqueta: `COALESCE(pl.nombre_plan_pago, '${SIN_DATO}')`,
        joins:
          "LEFT JOIN planes_pago pl ON pl.id_planes_pago = c.id_planes_pago",
        parametros: [],
      };
    case "estado":
      // `fecha_fin` es EXCLUSIVA: cubre mientras sea mayor que el día de hoy.
      return {
        clave:
          "CASE WHEN c.activo = 0 THEN 'INACTIVO' " +
          "WHEN c.fecha_fin > ? THEN 'VIGENTE' ELSE 'VENCIDA' END",
        etiqueta:
          "CASE WHEN c.activo = 0 THEN 'INACTIVO' " +
          "WHEN c.fecha_fin > ? THEN 'VIGENTE' ELSE 'VENCIDA' END",
        joins: "",
        parametros: [hoy, hoy],
      };
    case "sede":
      return {
        clave: `COALESCE(c.gym_id, '${SIN_DATO}')`,
        etiqueta: `COALESCE(g.nombre, c.gym_id, '${SIN_DATO}')`,
        joins: "LEFT JOIN gym g ON g.gym_id = c.gym_id",
        parametros: [],
      };
    case "moneda":
      return {
        clave: "p.moneda_id",
        etiqueta: "COALESCE(mo.moneda_nombre, p.moneda_id)",
        joins: "LEFT JOIN monedas mo ON mo.moneda_id = p.moneda_id",
        parametros: [],
      };
    case "cobrador":
      return {
        clave: `COALESCE(p.cobrado_por_user_id, '${SIN_DATO}')`,
        etiqueta: `COALESCE(p.cobrado_por_nombre_snapshot, '${SIN_DATO}')`,
        joins: "",
        parametros: [],
      };
    case "tipo_pago":
      return {
        clave: "d.tipo_pago_id",
        etiqueta: "COALESCE(tp.nombre_tipo_pago, d.tipo_pago_id)",
        joins: "LEFT JOIN tipo_pago tp ON tp.tipo_pago_id = d.tipo_pago_id",
        parametros: [],
      };
    case "cuenta":
      return {
        clave: `COALESCE(d.cuenta_id, '${SIN_DATO}')`,
        etiqueta: `COALESCE(cu.nombre_cuenta, '${SIN_DATO}')`,
        joins: "LEFT JOIN cuenta cu ON cu.cuenta_id = d.cuenta_id",
        parametros: [],
      };
  }
}

interface PiezaHecho {
  from: string;
  where: string;
  parametros: unknown[];
}

function piezaHecho(consulta: ConsultaSegmentacion): PiezaHecho {
  const { fuente, gymId, desde, hastaExclusiva, monedaId } = consulta;
  const conMoneda = monedaId ? " AND p.moneda_id = ?" : "";
  const paramMoneda = monedaId ? [monedaId] : [];

  switch (fuente) {
    case "cliente":
      return {
        from: "FROM cliente c",
        where: "WHERE c.gym_id = ? AND c.is_deleted = 0",
        parametros: [gymId],
      };
    case "membresia":
      return {
        from:
          "FROM membresia_cliente m " +
          "JOIN cliente c ON c.ci = m.ci AND c.is_deleted = 0",
        where:
          "WHERE m.gym_id = ? AND m.is_deleted = 0 AND m.origen = 'ALTA' " +
          "AND m.fecha_inicio >= ? AND m.fecha_inicio < ?",
        parametros: [gymId, desde, hastaExclusiva],
      };
    case "asistencia":
      return {
        from:
          "FROM asistencia a " +
          "JOIN cliente c ON c.ci = a.ci AND c.is_deleted = 0",
        where:
          "WHERE a.gym_id = ? AND a.is_deleted = 0 " +
          "AND a.created_at >= ? AND a.created_at < ?",
        parametros: [gymId, desde, hastaExclusiva],
      };
    case "pago":
      return {
        from:
          "FROM pago_cliente p " +
          "JOIN cliente c ON c.ci = p.ci AND c.is_deleted = 0",
        where:
          "WHERE p.gym_id = ? AND p.is_deleted = 0 " +
          `AND p.fecha >= ? AND p.fecha < ?${conMoneda}`,
        parametros: [
          gymId,
          desde,
          hastaExclusiva,
          ...paramMoneda,
        ],
      };
    case "detalle":
      return {
        from:
          "FROM detalle_pago d " +
          "JOIN pago_cliente p ON p.pago_cliente_id = d.pago_cliente_id " +
          "AND p.is_deleted = 0 " +
          "JOIN cliente c ON c.ci = p.ci AND c.is_deleted = 0",
        where:
          "WHERE p.gym_id = ? AND d.is_deleted = 0 " +
          "AND p.fecha >= ? AND p.fecha < ?" +
          // Aquí se filtra por la moneda del DETALLE, no por la de la cabecera:
          // lo que se está sumando es `d.cantidad`, y el esquema permite que un
          // detalle lleve otra moneda. Hoy nunca ocurre —comprobado— pero
          // filtrar por la cabecera sería sumar monedas distintas el día que
          // ocurra, y eso no puede depender de la suerte.
          (monedaId ? " AND d.moneda_id = ?" : ""),
        parametros: [
          gymId,
          desde,
          hastaExclusiva,
          ...paramMoneda,
        ],
      };
  }
}

interface PiezaMedida {
  numerador: string;
  denominador: string | null;
  filtroExtra: string;
}

function piezaMedida(medida: Medida, fuente: FuenteMedida): PiezaMedida {
  const soloConRecargo =
    " AND d.recargo_mora_importe IS NOT NULL" +
    " AND CAST(d.recargo_mora_importe AS DECIMAL(18,2)) > 0";

  switch (medida) {
    case "padron":
      return { numerador: "COUNT(*)", denominador: null, filtroExtra: "" };
    case "altas":
      return {
        numerador: "COUNT(DISTINCT m.membresia_id)",
        denominador: null,
        filtroExtra: "",
      };
    case "asistencias":
      return { numerador: "COUNT(*)", denominador: null, filtroExtra: "" };
    case "visitasPorSocio":
      return {
        numerador: "COUNT(*)",
        denominador: "COUNT(DISTINCT a.ci)",
        filtroExtra: "",
      };
    case "sociosQuePagaron":
      return {
        numerador: "COUNT(DISTINCT p.ci)",
        denominador: null,
        filtroExtra: "",
      };
    case "ingreso":
      return {
        // A nivel de detalle se suma `cantidad`, que es lo que se movió por ese
        // medio; a nivel de cobro, el total de la cabecera.
        numerador: fuente === "detalle"
          ? "SUM(d.cantidad)"
          : "SUM(p.monto_total)",
        denominador: null,
        filtroExtra: "",
      };
    case "ticketMedio":
      return {
        numerador: "SUM(p.monto_total)",
        denominador: "COUNT(DISTINCT p.pago_cliente_id)",
        filtroExtra: "",
      };
    case "descuento":
      return {
        numerador: "SUM(COALESCE(p.descuento_monto_snapshot, 0))",
        denominador: null,
        filtroExtra: "",
      };
    case "recargoMora":
      return {
        numerador: "SUM(CAST(d.recargo_mora_importe AS DECIMAL(18,2)))",
        denominador: null,
        filtroExtra: soloConRecargo,
      };
    case "diasAtrasoMedio":
      return {
        numerador: "SUM(COALESCE(d.recargo_mora_dias_atraso, 0))",
        denominador: "COUNT(*)",
        filtroExtra: soloConRecargo,
      };
  }
}

export class PrismaEstadisticasSegmentacionReader
  implements EstadisticasSegmentacionReader
{
  async leerSegmentacion(
    consulta: ConsultaSegmentacion,
  ): Promise<FilaSegmentacion[]> {
    const dimension = piezaDimension(consulta.dimension, consulta.hoy);
    const hecho = piezaHecho(consulta);
    const medida = piezaMedida(consulta.medida, consulta.fuente);
    const limite = Math.min(200, Math.max(1, Math.trunc(consulta.limite)));

    const sql =
      `SELECT ${dimension.clave} AS clave,
              ${dimension.etiqueta} AS etiqueta,
              ${medida.numerador} AS numerador,
              ${medida.denominador ?? "NULL"} AS denominador
         ${hecho.from}
         ${dimension.joins}
        ${hecho.where}${medida.filtroExtra}
        GROUP BY clave, etiqueta
        ORDER BY numerador DESC, etiqueta ASC
        LIMIT ${limite}`;

    const filas = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      sql,
      ...dimension.parametros,
      ...hecho.parametros,
    );

    return filas.map((fila) => {
      const numerador = numero(fila.numerador);
      const denominador = fila.denominador === null ||
          fila.denominador === undefined
        ? null
        : numero(fila.denominador);
      return {
        clave: String(fila.clave ?? SIN_DATO),
        etiqueta: String(fila.etiqueta ?? SIN_DATO),
        valor: denominador === null
          ? numerador
          : denominador === 0
          ? 0
          : Math.round((numerador / denominador) * 100) / 100,
        numerador: denominador === null ? null : numerador,
        denominador,
      };
    });
  }
}
