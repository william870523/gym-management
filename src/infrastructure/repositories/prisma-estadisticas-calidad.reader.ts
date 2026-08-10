/**
 * Panel de calidad de datos, sobre MariaDB.
 *
 * Cada consulta mide **un hueco concreto** y devuelve su denominador al lado. No
 * hay ninguna que cuente bajas: quién causó salida lo decide el motor canónico
 * de retención y llega por su puerto (regla 11 del plan). Lo único que se hace
 * aquí con las bajas es mirar la gestión de las que el motor ya señaló.
 *
 * Gemelo: `sqlite-estadisticas-calidad.reader.ts`. Del dialecto solo cambian los
 * parámetros de fecha —aquí viajan como `Date`, no como epoch— y nada más.
 */
import { prisma } from "../db/prismaClient";
import { trustedClock } from "../../config/trusted-clock";
import type {
  EstadisticasCalidadReader,
  LecturaCalidadAsistencias,
  LecturaCalidadCobros,
  LecturaCalidadMembresias,
  LecturaCalidadSocios,
} from "../../application/reporting/estadisticas-calidad.reader";

/** Horas tras las que una entrada sin salida deja de ser creíble. */
export const UMBRAL_HORAS_ABIERTA = 12;

/** Cuántos identificadores caben en un `IN (...)` sin castigar al motor. */
const LOTE_IDS = 400;

function numero(valor: unknown): number {
  return Number(valor ?? 0);
}

export class PrismaEstadisticasCalidadReader
  implements EstadisticasCalidadReader
{
  async leerSocios(gymId: string): Promise<LecturaCalidadSocios> {
    const [totales] = await prisma.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      `SELECT COUNT(*) AS padron,
              SUM(CASE WHEN c.fecha_nacimiento IS NULL THEN 1 ELSE 0 END)
                AS sin_fecha,
              SUM(CASE WHEN TRIM(COALESCE(c.sexo, '')) = '' THEN 1 ELSE 0 END)
                AS sin_sexo,
              SUM(CASE WHEN c.referencia_id IS NULL
                         OR TRIM(c.referencia_id) = '' THEN 1 ELSE 0 END)
                AS sin_referencia,
              SUM(CASE WHEN c.id_horarios IS NULL
                         OR TRIM(c.id_horarios) = '' THEN 1 ELSE 0 END)
                AS sin_horario
         FROM cliente c
        WHERE c.gym_id = ? AND c.is_deleted = 0`,
      gymId,
    );

    const variantes = await prisma.$queryRawUnsafe<
      Array<{ sexo: string | null }>
    >(
      `SELECT DISTINCT TRIM(c.sexo) AS sexo
         FROM cliente c
        WHERE c.gym_id = ? AND c.is_deleted = 0
          AND TRIM(COALESCE(c.sexo, '')) <> ''
        ORDER BY sexo ASC`,
      gymId,
    );

    return {
      padron: numero(totales?.padron),
      sinFechaNacimiento: numero(totales?.sin_fecha),
      sinSexo: numero(totales?.sin_sexo),
      variantesSexo: variantes
        .map((fila) => String(fila.sexo ?? "").trim())
        .filter((valor) => valor.length > 0),
      sinReferencia: numero(totales?.sin_referencia),
      sinHorario: numero(totales?.sin_horario),
    };
  }

  async leerMembresias(gymId: string): Promise<LecturaCalidadMembresias> {
    // Las canceladas quedan fuera del solape a propósito: un contrato anulado no
    // pisa la cobertura de nadie, y contarlo llenaría el panel de falsos.
    const [filas] = await prisma.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN m.fecha_fin <= m.fecha_inicio THEN 1 ELSE 0 END)
                AS invertidas,
              SUM(CASE WHEN NOT EXISTS (
                    SELECT 1 FROM planes_pago p
                     WHERE p.id_planes_pago = m.id_planes_pago
                       AND p.is_deleted = 0)
                  THEN 1 ELSE 0 END) AS sin_plan,
              SUM(CASE WHEN m.estado <> 'CANCELADA' AND EXISTS (
                    SELECT 1 FROM membresia_cliente o
                     WHERE o.ci = m.ci
                       AND o.gym_id = m.gym_id
                       AND o.is_deleted = 0
                       AND o.estado <> 'CANCELADA'
                       AND o.membresia_id <> m.membresia_id
                       AND o.fecha_inicio < m.fecha_fin
                       AND o.fecha_fin > m.fecha_inicio)
                  THEN 1 ELSE 0 END) AS solapadas
         FROM membresia_cliente m
        WHERE m.gym_id = ? AND m.is_deleted = 0`,
      gymId,
    );

    return {
      total: numero(filas?.total),
      solapadas: numero(filas?.solapadas),
      fechasInvertidas: numero(filas?.invertidas),
      sinPlanResoluble: numero(filas?.sin_plan),
    };
  }

  async leerAsistencias(gymId: string): Promise<LecturaCalidadAsistencias> {
    const corte = new Date(
      trustedClock.nowUtc().getTime() - UMBRAL_HORAS_ABIERTA * 3_600_000,
    );
    const [filas] = await prisma.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN a.created_at IS NULL THEN 1 ELSE 0 END)
                AS sin_instante,
              SUM(CASE WHEN a.fecha_salida IS NULL
                        AND a.created_at IS NOT NULL
                        AND a.created_at < ? THEN 1 ELSE 0 END) AS abiertas
         FROM asistencia a
        WHERE a.gym_id = ? AND a.is_deleted = 0`,
      corte,
      gymId,
    );

    return {
      total: numero(filas?.total),
      sinInstante: numero(filas?.sin_instante),
      abiertasAnomalas: numero(filas?.abiertas),
      umbralHorasAbierta: UMBRAL_HORAS_ABIERTA,
    };
  }

  async leerCobros(gymId: string): Promise<LecturaCalidadCobros> {
    const [filas] = await prisma.$queryRawUnsafe<
      Array<Record<string, unknown>>
    >(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN p.moneda_id IS NULL
                         OR TRIM(p.moneda_id) = '' THEN 1 ELSE 0 END)
                AS sin_moneda,
              SUM(CASE WHEN NOT EXISTS (
                    SELECT 1 FROM detalle_pago d
                     WHERE d.pago_cliente_id = p.pago_cliente_id
                       AND d.is_deleted = 0)
                  THEN 1 ELSE 0 END) AS sin_medio,
              SUM(CASE WHEN p.cobrado_por_user_id IS NULL
                         OR TRIM(p.cobrado_por_user_id) = '' THEN 1 ELSE 0 END)
                AS sin_cobrador
         FROM pago_cliente p
        WHERE p.gym_id = ? AND p.is_deleted = 0`,
      gymId,
    );

    return {
      total: numero(filas?.total),
      sinMoneda: numero(filas?.sin_moneda),
      sinMedio: numero(filas?.sin_medio),
      sinCobrador: numero(filas?.sin_cobrador),
    };
  }

  async contarBajasSinMotivo(
    gymId: string,
    membresiaIds: string[],
  ): Promise<number> {
    if (membresiaIds.length === 0) return 0;
    let total = 0;
    for (let inicio = 0; inicio < membresiaIds.length; inicio += LOTE_IDS) {
      const lote = membresiaIds.slice(inicio, inicio + LOTE_IDS);
      const marcadores = lote.map(() => "?").join(", ");
      // Solo cuenta la ÚLTIMA gestión de cada membresía: es la que decide el
      // motivo de la baja (§7-ter). Las que no tienen ninguna gestión no entran
      // aquí —las cuenta el control «bajas que nadie gestionó»— para que un
      // mismo hueco no se cobre dos veces.
      const [fila] = await prisma.$queryRawUnsafe<
        Array<{ total: unknown }>
      >(
        `SELECT COUNT(*) AS total FROM (
            SELECT g.membresia_id AS membresia_id,
                   (SELECT g2.motivo_baja_id
                      FROM retencion_gestion g2
                     WHERE g2.membresia_id = g.membresia_id
                       AND g2.gym_id = ?
                       AND g2.is_deleted = 0
                     ORDER BY g2.registrada_at DESC, g2.gestion_id DESC
                     LIMIT 1) AS motivo
              FROM retencion_gestion g
             WHERE g.gym_id = ?
               AND g.is_deleted = 0
               AND g.membresia_id IN (${marcadores})
             GROUP BY g.membresia_id
          ) ultimas
          WHERE ultimas.motivo IS NULL OR TRIM(ultimas.motivo) = ''`,
        gymId,
        gymId,
        ...lote,
      );
      total += numero(fila?.total);
    }
    return total;
  }
}
