import type {
  ConsultaRanking,
  EstadisticasRankingsReader,
  FilaRanking,
  IndicadoresAlerta,
  OrdenRanking,
  RankingAsistenciaSocio,
  RankingCambioEntrenador,
  RankingEntrenador,
  RankingPlan,
  RankingValorSocio,
  ResultadoRanking,
  ResumenRankings,
} from "../../application/reporting/estadisticas-rankings.reader";
import { prisma } from "../db/prismaClient";

const numero = (valor: unknown) => Number(valor ?? 0);

function fecha(valor: unknown): Date | null {
  if (valor == null) return null;
  const salida = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(salida.getTime()) ? null : salida;
}

function limiteSql(valor: number) {
  return Math.min(10, Math.max(1, Math.trunc(valor)));
}

/**
 * Cláusula LIMIT de la portada. `null` la omite: las alertas necesitan el
 * catálogo entero de planes y entrenadores, no solo la cabeza del ranking.
 */
function clausulaLimite(valor: number | null) {
  return valor === null ? "" : `LIMIT ${limiteSql(valor)}`;
}

export class PrismaEstadisticasRankingsReader
  implements EstadisticasRankingsReader
{
  async leerResumen(gymId: string, hoy: Date): Promise<ResumenRankings> {
    const corte18 = new Date(Date.UTC(
      hoy.getUTCFullYear() - 18,
      hoy.getUTCMonth(),
      hoy.getUTCDate(),
    ));
    const [totales, sexos] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT
           COUNT(*) AS socios_registrados,
           SUM(CASE WHEN c.activo = 1 THEN 1 ELSE 0 END) AS socios_activos,
           SUM(CASE WHEN c.fecha_nacimiento > ? THEN 1 ELSE 0 END) AS menores_18,
           SUM(CASE WHEN c.fecha_nacimiento IS NULL THEN 1 ELSE 0 END) AS sin_fecha,
           (SELECT COUNT(DISTINCT m.ci)
              FROM membresia_cliente m
              JOIN cliente cx ON cx.ci = m.ci
             WHERE m.gym_id = ? AND m.is_deleted = 0
               AND cx.gym_id = ? AND cx.is_deleted = 0 AND cx.activo = 1
               AND m.fecha_inicio <= ? AND m.fecha_fin > ?
               AND m.estado NOT IN ('CANCELADA', 'PENDIENTE_PAGO')
           ) AS con_cobertura
         FROM cliente c
        WHERE c.gym_id = ? AND c.is_deleted = 0`,
        corte18,
        gymId,
        gymId,
        hoy,
        hoy,
        gymId,
      ),
      prisma.$queryRawUnsafe<Array<{ etiqueta: string | null; total: unknown }>>(
        `SELECT COALESCE(NULLIF(TRIM(sexo), ''), 'SIN DATO') AS etiqueta,
                COUNT(*) AS total
           FROM cliente
          WHERE gym_id = ? AND is_deleted = 0
          GROUP BY etiqueta
          ORDER BY total DESC, etiqueta`,
        gymId,
      ),
    ]);
    const fila = totales[0] ?? {};
    return {
      sociosRegistrados: numero(fila.socios_registrados),
      sociosActivos: numero(fila.socios_activos),
      sociosConCobertura: numero(fila.con_cobertura),
      menores18: numero(fila.menores_18),
      sinFechaNacimiento: numero(fila.sin_fecha),
      porSexo: sexos.map((sexo) => ({
        etiqueta: sexo.etiqueta ?? "SIN DATO",
        total: numero(sexo.total),
      })),
    };
  }

  async leerIndicadoresAlerta(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
  ): Promise<IndicadoresAlerta> {
    const [visitas, mora] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT
           SUM(CASE WHEN a.created_at >= ? AND a.created_at < ?
                    THEN 1 ELSE 0 END) AS actual,
           SUM(CASE WHEN a.created_at >= ? AND a.created_at < ?
                    THEN 1 ELSE 0 END) AS anterior
         FROM asistencia a
        WHERE a.gym_id = ? AND a.is_deleted = 0`,
        desde,
        hastaExclusiva,
        desdeAnterior,
        hastaAnteriorExclusiva,
        gymId,
      ),
      // El recargo vive en el detalle del cobro y la moneda en su cabecera.
      // Se agrupa por moneda porque sumarlas sería inventar un total que no
      // existe. El cobro anulado no cuenta: el operativo es el neto.
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT p.moneda_id,
                SUM(CASE WHEN p.fecha >= ? AND p.fecha < ?
                         THEN CAST(d.recargo_mora_importe AS DECIMAL(18,2))
                         ELSE 0 END) AS importe_actual,
                SUM(CASE WHEN p.fecha >= ? AND p.fecha < ?
                         THEN CAST(d.recargo_mora_importe AS DECIMAL(18,2))
                         ELSE 0 END) AS importe_anterior,
                SUM(CASE WHEN p.fecha >= ? AND p.fecha < ?
                         THEN 1 ELSE 0 END) AS cobros_actual,
                SUM(CASE WHEN p.fecha >= ? AND p.fecha < ?
                         THEN 1 ELSE 0 END) AS cobros_anterior
           FROM detalle_pago d
           JOIN pago_cliente p ON p.pago_cliente_id = d.pago_cliente_id
          WHERE p.gym_id = ? AND p.is_deleted = 0 AND d.is_deleted = 0
            AND d.recargo_mora_importe IS NOT NULL
            AND CAST(d.recargo_mora_importe AS DECIMAL(18,2)) > 0
            AND p.fecha >= ? AND p.fecha < ?
          GROUP BY p.moneda_id
          ORDER BY p.moneda_id`,
        desde,
        hastaExclusiva,
        desdeAnterior,
        hastaAnteriorExclusiva,
        desde,
        hastaExclusiva,
        desdeAnterior,
        hastaAnteriorExclusiva,
        gymId,
        desdeAnterior,
        hastaExclusiva,
      ),
    ]);
    const fila = visitas[0] ?? {};
    return {
      visitas: {
        actual: numero(fila.actual),
        anterior: numero(fila.anterior),
      },
      mora: mora.map((moneda) => ({
        monedaId: String(moneda.moneda_id),
        importeActual: numero(moneda.importe_actual),
        importeAnterior: numero(moneda.importe_anterior),
        cobrosActual: numero(moneda.cobros_actual),
        cobrosAnterior: numero(moneda.cobros_anterior),
      })),
    };
  }

  async leerPlanes(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    hoy: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    _hoyAnterior: Date,
    limite: number | null,
  ): Promise<RankingPlan[]> {
    const top = clausulaLimite(limite);
    const filas = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT p.id_planes_pago AS id,
              COALESCE(p.nombre_plan_pago, 'Plan sin nombre') AS nombre,
              COUNT(DISTINCT CASE
                WHEN m.fecha_inicio >= ? AND m.fecha_inicio < ?
                THEN m.membresia_id END) AS vendidos,
              COUNT(DISTINCT CASE
                WHEN m.fecha_inicio >= ? AND m.fecha_inicio < ?
                THEN m.membresia_id END) AS vendidos_anterior,
              COUNT(DISTINCT CASE
                WHEN m.fecha_inicio <= ? AND m.fecha_fin > ?
                 AND m.estado NOT IN ('CANCELADA', 'PENDIENTE_PAGO')
                THEN m.ci END) AS con_cobertura,
              COUNT(DISTINCT CASE
                WHEN m.origen = 'RENOVACION'
                 AND m.fecha_inicio >= ? AND m.fecha_inicio < ?
                THEN m.membresia_id END) AS renovaciones
         FROM planes_pago p
         LEFT JOIN membresia_cliente m
           ON m.id_planes_pago = p.id_planes_pago
          AND m.gym_id = p.gym_id AND m.is_deleted = 0
        WHERE p.gym_id = ? AND p.is_deleted = 0
        GROUP BY p.id_planes_pago, p.nombre_plan_pago
        ORDER BY vendidos DESC, nombre ASC
        ${top}`,
      desde,
      hastaExclusiva,
      desdeAnterior,
      hastaAnteriorExclusiva,
      hoy,
      hoy,
      desde,
      hastaExclusiva,
      gymId,
    );
    return filas.map((fila) => ({
      id: String(fila.id),
      nombre: String(fila.nombre),
      vendidos: numero(fila.vendidos),
      vendidosAnterior: numero(fila.vendidos_anterior),
      sociosConCobertura: numero(fila.con_cobertura),
      renovaciones: numero(fila.renovaciones),
    }));
  }

  async leerEntrenadores(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    hoy: Date,
    _desdeAnterior: Date,
    _hastaAnteriorExclusiva: Date,
    hoyAnterior: Date,
    limite: number | null,
  ): Promise<RankingEntrenador[]> {
    const top = clausulaLimite(limite);
    const filas = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT e.id_entrenador AS id,
              CONCAT(e.nombres_entrenador, ' ', e.apellidos_entrenador) AS nombre,
              COUNT(DISTINCT CASE
                WHEN a.fecha_inicio <= ?
                 AND (a.fecha_fin IS NULL OR a.fecha_fin > ?)
                THEN m.ci END)
                AS cartera_activa,
              COUNT(DISTINCT CASE
                WHEN a.fecha_inicio <= ?
                 AND (a.fecha_fin IS NULL OR a.fecha_fin > ?)
                THEN m.ci END) AS cartera_activa_anterior,
              COUNT(DISTINCT CASE
                WHEN a.fecha_inicio >= ? AND a.fecha_inicio < ? THEN m.ci END)
                AS ganados,
              COUNT(DISTINCT CASE
                WHEN a.estado = 'CERRADA'
                 AND a.fecha_fin >= ? AND a.fecha_fin < ?
                 AND NOT EXISTS (
                   SELECT 1
                     FROM membresia_entrenador_asignacion ax
                     JOIN membresia_cliente mx
                       ON mx.membresia_id = ax.membresia_id
                    WHERE ax.gym_id = a.gym_id
                      AND ax.id_entrenador = a.id_entrenador
                      AND ax.is_deleted = 0 AND ax.estado = 'ACTIVA'
                      AND mx.ci = m.ci
                 )
                THEN m.ci END) AS perdidos
         FROM entrenadores e
         LEFT JOIN membresia_entrenador_asignacion a
           ON a.id_entrenador = e.id_entrenador
          AND a.gym_id = e.gym_id AND a.is_deleted = 0
         LEFT JOIN membresia_cliente m
           ON m.membresia_id = a.membresia_id AND m.is_deleted = 0
        WHERE e.gym_id = ? AND e.is_deleted = 0
        GROUP BY e.id_entrenador, e.nombres_entrenador, e.apellidos_entrenador
        ORDER BY cartera_activa DESC, ganados DESC, nombre ASC
        ${top}`,
      hoy,
      hoy,
      hoyAnterior,
      hoyAnterior,
      desde,
      hastaExclusiva,
      desde,
      hastaExclusiva,
      gymId,
    );
    return filas.map((fila) => ({
      id: String(fila.id),
      nombre: String(fila.nombre).trim(),
      carteraActiva: numero(fila.cartera_activa),
      carteraActivaAnterior: numero(fila.cartera_activa_anterior),
      ganados: numero(fila.ganados),
      perdidos: numero(fila.perdidos),
    }));
  }

  async leerSociosPorVisitas(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    limite: number,
  ): Promise<RankingAsistenciaSocio[]> {
    const top = limiteSql(limite);
    const filas = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT c.ci,
              CONCAT(c.nombres, ' ', c.apellidos) AS nombre,
              c.fecha_inicio,
              SUM(CASE
                WHEN a.created_at >= ? AND a.created_at < ? THEN 1 ELSE 0 END)
                AS visitas,
              SUM(CASE
                WHEN a.created_at >= ? AND a.created_at < ? THEN 1 ELSE 0 END)
                AS visitas_anterior,
              MAX(CASE WHEN a.created_at < ? THEN a.created_at END)
                AS ultima_visita,
              MAX(CASE WHEN a.created_at < ? THEN a.created_at END)
                AS ultima_visita_anterior
         FROM cliente c
         LEFT JOIN asistencia a
           ON a.ci = c.ci AND a.gym_id = c.gym_id AND a.is_deleted = 0
        WHERE c.gym_id = ? AND c.is_deleted = 0 AND c.activo = 1
        GROUP BY c.ci, c.nombres, c.apellidos, c.fecha_inicio
        ORDER BY visitas DESC, nombre ASC
        LIMIT ${top}`,
      desde,
      hastaExclusiva,
      desdeAnterior,
      hastaAnteriorExclusiva,
      hastaExclusiva,
      hastaAnteriorExclusiva,
      gymId,
    );
    return filas.flatMap((fila) => {
      const fechaInicio = fecha(fila.fecha_inicio);
      if (!fechaInicio) return [];
      return [{
        ci: String(fila.ci),
        nombre: String(fila.nombre).trim(),
        visitas: numero(fila.visitas),
        visitasAnterior: numero(fila.visitas_anterior),
        ultimaVisita: fecha(fila.ultima_visita),
        ultimaVisitaAnterior: fecha(fila.ultima_visita_anterior),
        fechaInicio,
      }];
    });
  }

  async leerSociosPorInactividad(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    limite: number,
  ): Promise<RankingAsistenciaSocio[]> {
    const top = limiteSql(limite);
    const filas = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT c.ci,
              CONCAT(c.nombres, ' ', c.apellidos) AS nombre,
              c.fecha_inicio,
              SUM(CASE
                WHEN a.created_at >= ? AND a.created_at < ? THEN 1 ELSE 0 END)
                AS visitas,
              SUM(CASE
                WHEN a.created_at >= ? AND a.created_at < ? THEN 1 ELSE 0 END)
                AS visitas_anterior,
              MAX(CASE WHEN a.created_at < ? THEN a.created_at END)
                AS ultima_visita,
              MAX(CASE WHEN a.created_at < ? THEN a.created_at END)
                AS ultima_visita_anterior
         FROM cliente c
         LEFT JOIN asistencia a
           ON a.ci = c.ci AND a.gym_id = c.gym_id AND a.is_deleted = 0
        WHERE c.gym_id = ? AND c.is_deleted = 0 AND c.activo = 1
        GROUP BY c.ci, c.nombres, c.apellidos, c.fecha_inicio
        ORDER BY COALESCE(MAX(a.created_at), c.fecha_inicio) ASC,
                 visitas ASC,
                 nombre ASC
        LIMIT ${top}`,
      desde,
      hastaExclusiva,
      desdeAnterior,
      hastaAnteriorExclusiva,
      hastaExclusiva,
      hastaAnteriorExclusiva,
      gymId,
    );
    return filas.flatMap((fila) => {
      const fechaInicio = fecha(fila.fecha_inicio);
      if (!fechaInicio) return [];
      return [{
        ci: String(fila.ci),
        nombre: String(fila.nombre).trim(),
        visitas: numero(fila.visitas),
        visitasAnterior: numero(fila.visitas_anterior),
        ultimaVisita: fecha(fila.ultima_visita),
        ultimaVisitaAnterior: fecha(fila.ultima_visita_anterior),
        fechaInicio,
      }];
    });
  }

  async leerCambiosEntrenador(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    limite: number,
  ): Promise<RankingCambioEntrenador[]> {
    const top = limiteSql(limite);
    const filas = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH historia AS (
         SELECT m.ci,
                a.id_entrenador,
                a.fecha_inicio,
                LAG(a.id_entrenador) OVER (
                  PARTITION BY m.ci
                  ORDER BY a.fecha_inicio, a.asignacion_id
                ) AS anterior
           FROM membresia_entrenador_asignacion a
           JOIN membresia_cliente m ON m.membresia_id = a.membresia_id
          WHERE a.gym_id = ? AND a.is_deleted = 0 AND m.is_deleted = 0
       )
       SELECT c.ci,
              CONCAT(c.nombres, ' ', c.apellidos) AS nombre,
              SUM(CASE WHEN h.anterior IS NOT NULL
                         AND h.anterior <> h.id_entrenador
                         AND h.fecha_inicio >= ? AND h.fecha_inicio < ?
                       THEN 1 ELSE 0 END) AS cambios,
              SUM(CASE WHEN h.anterior IS NOT NULL
                         AND h.anterior <> h.id_entrenador
                         AND h.fecha_inicio >= ? AND h.fecha_inicio < ?
                       THEN 1 ELSE 0 END) AS cambios_anterior
         FROM historia h
         JOIN cliente c ON c.ci = h.ci
        WHERE c.gym_id = ? AND c.is_deleted = 0
          AND h.fecha_inicio >= ? AND h.fecha_inicio < ?
        GROUP BY c.ci, c.nombres, c.apellidos
       HAVING cambios > 0 OR cambios_anterior > 0
        ORDER BY cambios DESC, nombre ASC
        LIMIT ${top}`,
      gymId,
      desde,
      hastaExclusiva,
      desdeAnterior,
      hastaAnteriorExclusiva,
      gymId,
      desdeAnterior,
      hastaExclusiva,
    );
    return filas.map((fila) => ({
      ci: String(fila.ci),
      nombre: String(fila.nombre).trim(),
      cambios: numero(fila.cambios),
      cambiosAnterior: numero(fila.cambios_anterior),
    }));
  }

  async leerValorSocios(
    gymId: string,
    desde: Date,
    hastaExclusiva: Date,
    desdeAnterior: Date,
    hastaAnteriorExclusiva: Date,
    limite: number,
  ): Promise<RankingValorSocio[]> {
    const top = limiteSql(limite);
    const filas = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `WITH totales AS (
         SELECT c.ci,
                CONCAT(c.nombres, ' ', c.apellidos) AS nombre,
                p.moneda_id,
                SUM(CASE WHEN p.fecha >= ? AND p.fecha < ?
                         THEN p.monto_total ELSE 0 END) AS total,
                SUM(CASE WHEN p.fecha >= ? AND p.fecha < ?
                         THEN p.monto_total ELSE 0 END) AS total_anterior
           FROM pago_cliente p
           JOIN cliente c ON c.ci = p.ci
          WHERE p.gym_id = ? AND p.is_deleted = 0
            AND c.gym_id = ? AND c.is_deleted = 0
            AND p.fecha >= ? AND p.fecha < ?
          GROUP BY c.ci, c.nombres, c.apellidos, p.moneda_id
       ),
       ordenados AS (
         SELECT totales.*,
                ROW_NUMBER() OVER (
                  PARTITION BY moneda_id
                  ORDER BY total DESC, nombre ASC
                ) AS posicion
           FROM totales
       )
       SELECT ci, nombre, moneda_id, total, total_anterior
         FROM ordenados
        WHERE posicion <= ${top}
        ORDER BY moneda_id ASC, posicion ASC`,
      desde,
      hastaExclusiva,
      desdeAnterior,
      hastaAnteriorExclusiva,
      gymId,
      gymId,
      desdeAnterior,
      hastaExclusiva,
    );
    return filas.map((fila) => ({
      ci: String(fila.ci),
      nombre: String(fila.nombre).trim(),
      monedaId: String(fila.moneda_id),
      total: numero(fila.total),
      totalAnterior: numero(fila.total_anterior),
    }));
  }

  async leerRanking(consulta: ConsultaRanking): Promise<ResultadoRanking> {
    const direccion = consulta.direccion.toUpperCase();
    const limite = Math.min(10_000, Math.max(1, Math.trunc(consulta.limite)));
    const offset = Math.max(0, Math.trunc(consulta.offset));
    let base = "";
    let parametros: unknown[] = [];
    let idColumna = "id";
    let ordenes: Partial<Record<OrdenRanking, string>> = {};
    let invertirDireccion = false;
    let mapear: (fila: Record<string, unknown>) => FilaRanking;

    switch (consulta.tipo) {
      case "planes":
        base = `SELECT p.id_planes_pago AS id,
                       COALESCE(p.nombre_plan_pago, 'Plan sin nombre') AS nombre,
                       COUNT(DISTINCT CASE
                         WHEN m.fecha_inicio >= ? AND m.fecha_inicio < ?
                         THEN m.membresia_id END) AS vendidos,
                       COUNT(DISTINCT CASE
                         WHEN m.fecha_inicio >= ? AND m.fecha_inicio < ?
                         THEN m.membresia_id END) AS vendidos_anterior,
                       COUNT(DISTINCT CASE
                         WHEN m.fecha_inicio <= ? AND m.fecha_fin > ?
                          AND m.estado NOT IN ('CANCELADA', 'PENDIENTE_PAGO')
                         THEN m.ci END) AS socios_con_cobertura,
                       COUNT(DISTINCT CASE
                         WHEN m.origen = 'RENOVACION'
                          AND m.fecha_inicio >= ? AND m.fecha_inicio < ?
                         THEN m.membresia_id END) AS renovaciones
                  FROM planes_pago p
                  LEFT JOIN membresia_cliente m
                    ON m.id_planes_pago = p.id_planes_pago
                   AND m.gym_id = p.gym_id AND m.is_deleted = 0
                 WHERE p.gym_id = ? AND p.is_deleted = 0
                 GROUP BY p.id_planes_pago, p.nombre_plan_pago`;
        parametros = [
          consulta.desde,
          consulta.hastaExclusiva,
          consulta.desdeAnterior,
          consulta.hastaAnteriorExclusiva,
          consulta.hoy,
          consulta.hoy,
          consulta.desde,
          consulta.hastaExclusiva,
          consulta.gymId,
        ];
        ordenes = {
          nombre: "nombre",
          vendidos: "vendidos",
          sociosConCobertura: "socios_con_cobertura",
          renovaciones: "renovaciones",
        };
        mapear = (fila) => ({
          id: String(fila.id),
          nombre: String(fila.nombre),
          vendidos: numero(fila.vendidos),
          vendidosAnterior: numero(fila.vendidos_anterior),
          sociosConCobertura: numero(fila.socios_con_cobertura),
          renovaciones: numero(fila.renovaciones),
        });
        break;
      case "entrenadores":
        base = `SELECT e.id_entrenador AS id,
                       CONCAT(e.nombres_entrenador, ' ',
                              e.apellidos_entrenador) AS nombre,
                       COUNT(DISTINCT CASE
                         WHEN a.fecha_inicio <= ?
                          AND (a.fecha_fin IS NULL OR a.fecha_fin > ?)
                         THEN m.ci END)
                         AS cartera_activa,
                       COUNT(DISTINCT CASE
                         WHEN a.fecha_inicio <= ?
                          AND (a.fecha_fin IS NULL OR a.fecha_fin > ?)
                         THEN m.ci END) AS cartera_activa_anterior,
                       COUNT(DISTINCT CASE
                         WHEN a.fecha_inicio >= ? AND a.fecha_inicio < ?
                         THEN m.ci END) AS ganados,
                       COUNT(DISTINCT CASE
                         WHEN a.estado = 'CERRADA'
                          AND a.fecha_fin >= ? AND a.fecha_fin < ?
                          AND NOT EXISTS (
                            SELECT 1
                              FROM membresia_entrenador_asignacion ax
                              JOIN membresia_cliente mx
                                ON mx.membresia_id = ax.membresia_id
                             WHERE ax.gym_id = a.gym_id
                               AND ax.id_entrenador = a.id_entrenador
                               AND ax.is_deleted = 0 AND ax.estado = 'ACTIVA'
                               AND mx.ci = m.ci
                          )
                         THEN m.ci END) AS perdidos
                  FROM entrenadores e
                  LEFT JOIN membresia_entrenador_asignacion a
                    ON a.id_entrenador = e.id_entrenador
                   AND a.gym_id = e.gym_id AND a.is_deleted = 0
                  LEFT JOIN membresia_cliente m
                    ON m.membresia_id = a.membresia_id AND m.is_deleted = 0
                 WHERE e.gym_id = ? AND e.is_deleted = 0
                 GROUP BY e.id_entrenador, e.nombres_entrenador,
                          e.apellidos_entrenador`;
        parametros = [
          consulta.hoy,
          consulta.hoy,
          consulta.hoyAnterior,
          consulta.hoyAnterior,
          consulta.desde,
          consulta.hastaExclusiva,
          consulta.desde,
          consulta.hastaExclusiva,
          consulta.gymId,
        ];
        ordenes = {
          nombre: "nombre",
          carteraActiva: "cartera_activa",
          ganados: "ganados",
          perdidos: "perdidos",
        };
        mapear = (fila) => ({
          id: String(fila.id),
          nombre: String(fila.nombre).trim(),
          carteraActiva: numero(fila.cartera_activa),
          carteraActivaAnterior: numero(fila.cartera_activa_anterior),
          ganados: numero(fila.ganados),
          perdidos: numero(fila.perdidos),
        });
        break;
      case "socios-visitas":
      case "socios-inactividad":
        idColumna = "ci";
        base = `SELECT c.ci,
                       CONCAT(c.nombres, ' ', c.apellidos) AS nombre,
                       c.fecha_inicio,
                       SUM(CASE
                         WHEN a.created_at >= ? AND a.created_at < ?
                         THEN 1 ELSE 0 END) AS visitas,
                       SUM(CASE
                         WHEN a.created_at >= ? AND a.created_at < ?
                         THEN 1 ELSE 0 END) AS visitas_anterior,
                       MAX(CASE WHEN a.created_at < ? THEN a.created_at END)
                         AS ultima_visita,
                       MAX(CASE WHEN a.created_at < ? THEN a.created_at END)
                         AS ultima_visita_anterior
                  FROM cliente c
                  LEFT JOIN asistencia a
                    ON a.ci = c.ci AND a.gym_id = c.gym_id
                   AND a.is_deleted = 0
                 WHERE c.gym_id = ? AND c.is_deleted = 0 AND c.activo = 1
                 GROUP BY c.ci, c.nombres, c.apellidos, c.fecha_inicio`;
        parametros = [
          consulta.desde,
          consulta.hastaExclusiva,
          consulta.desdeAnterior,
          consulta.hastaAnteriorExclusiva,
          consulta.hastaExclusiva,
          consulta.hastaAnteriorExclusiva,
          consulta.gymId,
        ];
        ordenes = {
          nombre: "nombre",
          visitas: "visitas",
          diasSinVisita: "COALESCE(ultima_visita, fecha_inicio)",
        };
        invertirDireccion = consulta.orden === "diasSinVisita";
        mapear = (fila) => ({
          ci: String(fila.ci),
          nombre: String(fila.nombre).trim(),
          visitas: numero(fila.visitas),
          visitasAnterior: numero(fila.visitas_anterior),
          ultimaVisita: fecha(fila.ultima_visita),
          ultimaVisitaAnterior: fecha(fila.ultima_visita_anterior),
          fechaInicio: fecha(fila.fecha_inicio) ??
            new Date(consulta.desde.getTime()),
        });
        break;
      case "socios-cambios-entrenador":
        idColumna = "ci";
        base = `SELECT c.ci,
                       CONCAT(c.nombres, ' ', c.apellidos) AS nombre,
                       SUM(CASE WHEN h.anterior IS NOT NULL
                                  AND h.anterior <> h.id_entrenador
                                  AND h.fecha_inicio >= ?
                                  AND h.fecha_inicio < ?
                                THEN 1 ELSE 0 END) AS cambios,
                       SUM(CASE WHEN h.anterior IS NOT NULL
                                  AND h.anterior <> h.id_entrenador
                                  AND h.fecha_inicio >= ?
                                  AND h.fecha_inicio < ?
                                THEN 1 ELSE 0 END) AS cambios_anterior
                  FROM (
                    SELECT m.ci,
                           a.id_entrenador,
                           a.fecha_inicio,
                           LAG(a.id_entrenador) OVER (
                             PARTITION BY m.ci
                             ORDER BY a.fecha_inicio, a.asignacion_id
                           ) AS anterior
                      FROM membresia_entrenador_asignacion a
                      JOIN membresia_cliente m
                        ON m.membresia_id = a.membresia_id
                     WHERE a.gym_id = ? AND a.is_deleted = 0
                       AND m.is_deleted = 0
                  ) h
                  JOIN cliente c ON c.ci = h.ci
                 WHERE c.gym_id = ? AND c.is_deleted = 0
                   AND h.fecha_inicio >= ? AND h.fecha_inicio < ?
                 GROUP BY c.ci, c.nombres, c.apellidos
                HAVING cambios > 0 OR cambios_anterior > 0`;
        parametros = [
          consulta.desde,
          consulta.hastaExclusiva,
          consulta.desdeAnterior,
          consulta.hastaAnteriorExclusiva,
          consulta.gymId,
          consulta.gymId,
          consulta.desdeAnterior,
          consulta.hastaExclusiva,
        ];
        ordenes = { nombre: "nombre", cambios: "cambios" };
        mapear = (fila) => ({
          ci: String(fila.ci),
          nombre: String(fila.nombre).trim(),
          cambios: numero(fila.cambios),
          cambiosAnterior: numero(fila.cambios_anterior),
        });
        break;
      case "socios-valor":
        idColumna = "ci";
        base = `SELECT c.ci,
                       CONCAT(c.nombres, ' ', c.apellidos) AS nombre,
                       p.moneda_id,
                       SUM(CASE WHEN p.fecha >= ? AND p.fecha < ?
                                THEN p.monto_total ELSE 0 END) AS total,
                       SUM(CASE WHEN p.fecha >= ? AND p.fecha < ?
                                THEN p.monto_total ELSE 0 END) AS total_anterior
                  FROM pago_cliente p
                  JOIN cliente c ON c.ci = p.ci
                 WHERE p.gym_id = ? AND p.is_deleted = 0
                   AND c.gym_id = ? AND c.is_deleted = 0
                   AND p.fecha >= ? AND p.fecha < ?
                   AND p.moneda_id = ?
                 GROUP BY c.ci, c.nombres, c.apellidos, p.moneda_id`;
        parametros = [
          consulta.desde,
          consulta.hastaExclusiva,
          consulta.desdeAnterior,
          consulta.hastaAnteriorExclusiva,
          consulta.gymId,
          consulta.gymId,
          consulta.desdeAnterior,
          consulta.hastaExclusiva,
          consulta.monedaId,
        ];
        ordenes = { nombre: "nombre", total: "total" };
        mapear = (fila) => ({
          ci: String(fila.ci),
          nombre: String(fila.nombre).trim(),
          monedaId: String(fila.moneda_id),
          total: numero(fila.total),
          totalAnterior: numero(fila.total_anterior),
        });
        break;
    }

    const filtro = consulta.busqueda
      ? `WHERE (LOWER(nombre) LIKE LOWER(?) OR
                LOWER(CAST(${idColumna} AS CHAR)) LIKE LOWER(?))`
      : "";
    const parametrosFiltro = consulta.busqueda
      ? [`%${consulta.busqueda}%`, `%${consulta.busqueda}%`]
      : [];
    const expresionOrden = ordenes[consulta.orden];
    if (!expresionOrden) {
      throw new Error("ORDEN_RANKING_NO_IMPLEMENTADO");
    }
    const direccionSql = invertirDireccion
      ? (direccion === "ASC" ? "DESC" : "ASC")
      : direccion;
    const [conteo, filas] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT COUNT(*) AS total FROM (${base}) ranking ${filtro}`,
        ...parametros,
        ...parametrosFiltro,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT * FROM (${base}) ranking
          ${filtro}
         ORDER BY ${expresionOrden} ${direccionSql}, nombre ASC,
                  ${idColumna} ASC
         LIMIT ${limite} OFFSET ${offset}`,
        ...parametros,
        ...parametrosFiltro,
      ),
    ]);
    return {
      total: numero(conteo[0]?.total),
      filas: filas.map(mapear),
    };
  }
}
