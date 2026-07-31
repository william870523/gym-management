/**
 * Implementación MariaDB del perfil del entrenador.
 *
 * MariaDB y el proceso operan en UTC. Todo valor crudo pasa por `aFecha`; el
 * mes local se resuelve por instante con la zona IANA de la sede para respetar
 * el DST histórico.
 */
import { prisma } from "../db/prismaClient";
import { calendarioLocal } from "../../application/reporting/calendario-estadisticas";
import { franjaDe } from "../../application/reporting/estadisticas-socio.service";
import { movimientosCarteraPorMes } from "../../application/reporting/movimientos-cartera";
import type {
  EstadisticasEntrenadorReader,
  FilaCarteraEntrenador,
  FilaConteo,
  FilaIngresoMoneda,
  FilaMovimientoMes,
  FilaRenovacionCartera,
  FilaSocioCartera,
} from "../../application/reporting/estadisticas-entrenador.reader";

function aFecha(valor: unknown): Date | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === "number") return new Date(valor);
  if (typeof valor === "bigint") return new Date(Number(valor));
  if (typeof valor === "string") {
    const numero = Number(valor);
    const fecha = Number.isFinite(numero) ? new Date(numero) : new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }
  return null;
}

export class PrismaEstadisticasEntrenadorReader
  implements EstadisticasEntrenadorReader
{
  async leerEntrenador(gymId: string, id: string) {
    const filas = await prisma.$queryRawUnsafe<
      Array<{
        id_entrenador: string;
        nombres_entrenador: string;
        apellidos_entrenador: string;
        sexo_entrenador: string;
        activo_entrenador: number | boolean;
        fecha_incio_entrenador: unknown;
      }>
    >(
      `SELECT id_entrenador, nombres_entrenador, apellidos_entrenador,
              sexo_entrenador, activo_entrenador, fecha_incio_entrenador
         FROM entrenadores
        WHERE id_entrenador = ? AND gym_id = ? AND is_deleted = 0`,
      id,
      gymId,
    );
    const fila = filas[0];
    if (!fila) return null;
    return {
      id: fila.id_entrenador,
      nombre:
        `${fila.nombres_entrenador} ${fila.apellidos_entrenador}`.trim(),
      sexo: fila.sexo_entrenador,
      activo: Boolean(fila.activo_entrenador),
      desde: aFecha(fila.fecha_incio_entrenador),
    };
  }

  async leerCartera(
    gymId: string,
    id: string,
  ): Promise<FilaCarteraEntrenador> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ activos: bigint | number; historicos: bigint | number; cerradas: bigint | number }>
    >(
      // Se cuentan SOCIOS, no asignaciones. Un socio con seis renovaciones
      // genera seis asignaciones: contarlas daría una cartera 3,5 veces mayor
      // que la real, y «activos» superaría a «históricos», que es imposible.
      //
      // «Perdidos» son los socios que tuvieron una asignación cerrada con él y
      // hoy no tienen ninguna abierta: los que se le fueron de verdad, no los
      // que simplemente renovaron y abrieron una asignación nueva.
      `SELECT
         COUNT(DISTINCT CASE WHEN a.estado = 'ACTIVA' THEN m.ci END) AS activos,
         COUNT(DISTINCT m.ci) AS historicos,
         COUNT(DISTINCT CASE
                 WHEN a.estado = 'CERRADA' AND m.ci NOT IN (
                   SELECT m2.ci
                     FROM membresia_entrenador_asignacion a2
                     JOIN membresia_cliente m2 ON m2.membresia_id = a2.membresia_id
                    WHERE a2.id_entrenador = a.id_entrenador
                      AND a2.gym_id = a.gym_id
                      AND a2.is_deleted = 0
                      AND a2.estado = 'ACTIVA'
                 )
                 THEN m.ci END) AS cerradas
       FROM membresia_entrenador_asignacion a
       JOIN membresia_cliente m ON m.membresia_id = a.membresia_id
      WHERE a.id_entrenador = ? AND a.gym_id = ? AND a.is_deleted = 0`,
      id,
      gymId,
    );
    const fila = filas[0];
    return {
      activos: Number(fila?.activos ?? 0),
      historicos: Number(fila?.historicos ?? 0),
      cerradas: Number(fila?.cerradas ?? 0),
    };
  }

  async leerMovimientos(
    gymId: string,
    id: string,
    zona: string,
  ): Promise<FilaMovimientoMes[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ ci: string; fecha_inicio: unknown; fecha_fin: unknown }>
    >(
      `SELECT m.ci, a.fecha_inicio, a.fecha_fin
         FROM membresia_entrenador_asignacion a
         JOIN membresia_cliente m ON m.membresia_id = a.membresia_id
        WHERE a.id_entrenador = ? AND a.gym_id = ? AND a.is_deleted = 0
          AND m.is_deleted = 0
        ORDER BY m.ci, a.fecha_inicio`,
      id,
      gymId,
    );
    return movimientosCarteraPorMes(
      filas.flatMap((fila) => {
        const desde = aFecha(fila.fecha_inicio);
        if (!desde) return [];
        return [{
          ci: fila.ci,
          desde,
          hasta: aFecha(fila.fecha_fin),
        }];
      }),
      zona,
    );
  }

  async leerMotivosCierre(gymId: string, id: string): Promise<FilaConteo[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ motivo: string | null; total: bigint | number }>
    >(
      `SELECT motivo_cierre AS motivo, COUNT(*) AS total
         FROM membresia_entrenador_asignacion
        WHERE id_entrenador = ? AND gym_id = ? AND is_deleted = 0
          AND estado = 'CERRADA'
        GROUP BY motivo_cierre
        ORDER BY total DESC`,
      id,
      gymId,
    );
    return filas.map((f) => ({
      etiqueta: f.motivo ?? "Sin motivo registrado",
      total: Number(f.total),
    }));
  }

  async leerComposicion(
    gymId: string,
    id: string,
    dimension: "sexo" | "categoria" | "horario" | "plan" | "nacionalidad",
  ): Promise<FilaConteo[]> {
    // La etiqueta legible se resuelve en SQL donde existe catálogo; donde no,
    // se devuelve el valor tal cual y la vista lo muestra como está.
    const seleccion = {
      sexo: "c.sexo",
      categoria: "COALESCE(c.categoria, 'SIN CATEGORÍA')",
      horario: "COALESCE(h.nombre_horario, 'Sin franja')",
      plan: "COALESCE(p.nombre_plan_pago, 'Sin plan')",
      nacionalidad: "COALESCE(n.nacionalidad_nombre, 'Sin nacionalidad')",
    }[dimension];
    const joins =
      dimension === "horario"
        ? "LEFT JOIN horario h ON h.horario_id = c.id_horarios"
        : dimension === "plan"
          ? "LEFT JOIN planes_pago p ON p.id_planes_pago = m.id_planes_pago"
          : dimension === "nacionalidad"
            ? "LEFT JOIN nacionalidades n ON n.nacionalidad_id = c.nacionalidad_id"
            : "";

    const filas = await prisma.$queryRawUnsafe<
      Array<{ etiqueta: string | null; total: bigint | number }>
    >(
      `SELECT ${seleccion} AS etiqueta, COUNT(DISTINCT c.ci) AS total
         FROM membresia_entrenador_asignacion a
         JOIN membresia_cliente m ON m.membresia_id = a.membresia_id
         JOIN cliente c ON c.ci = m.ci
         ${joins}
        WHERE a.id_entrenador = ? AND a.gym_id = ? AND a.is_deleted = 0
          AND a.estado = 'ACTIVA' AND c.is_deleted = 0
        GROUP BY etiqueta
        ORDER BY total DESC`,
      id,
      gymId,
    );
    return filas.map((f) => ({
      etiqueta: f.etiqueta ?? "—",
      total: Number(f.total),
    }));
  }

  async leerFranjasObservadas(
    gymId: string,
    id: string,
    zona: string,
  ): Promise<FilaConteo[]> {
    const filas = await prisma.$queryRawUnsafe<Array<{ created_at: unknown }>>(
      `SELECT s.created_at
         FROM asistencia s
        WHERE s.gym_id = ? AND s.is_deleted = 0 AND s.created_at IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM membresia_entrenador_asignacion a
              JOIN membresia_cliente m
                ON m.membresia_id = a.membresia_id
             WHERE a.id_entrenador = ? AND a.gym_id = ?
               AND a.is_deleted = 0 AND m.is_deleted = 0
               AND m.ci = s.ci
               AND s.created_at >= a.fecha_inicio
               AND (a.fecha_fin IS NULL OR s.created_at < a.fecha_fin)
          )`,
      gymId,
      id,
      gymId,
    );
    const conteo = new Map<string, number>();
    for (const fila of filas) {
      const instante = aFecha(fila.created_at);
      if (!instante) continue;
      const franja = franjaDe(calendarioLocal(instante, zona).hora);
      conteo.set(franja, (conteo.get(franja) ?? 0) + 1);
    }
    return [...conteo.entries()]
      .map(([etiqueta, total]) => ({ etiqueta, total }))
      .sort((a, b) => b.total - a.total);
  }

  async leerSociosPorVisitas(
    gymId: string,
    id: string,
    limite: number,
  ): Promise<FilaSocioCartera[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ ci: string; nombre: string; visitas: bigint | number }>
    >(
      `SELECT c.ci AS ci,
              CONCAT(c.nombres, ' ', c.apellidos) AS nombre,
              (SELECT COUNT(*) FROM asistencia s
                WHERE s.ci = c.ci AND s.gym_id = ? AND s.is_deleted = 0) AS visitas
         FROM membresia_entrenador_asignacion a
         JOIN membresia_cliente m ON m.membresia_id = a.membresia_id
         JOIN cliente c ON c.ci = m.ci
        WHERE a.id_entrenador = ? AND a.gym_id = ? AND a.is_deleted = 0
          AND a.estado = 'ACTIVA' AND c.is_deleted = 0
        GROUP BY c.ci
        ORDER BY visitas DESC
        LIMIT ?`,
      gymId,
      id,
      gymId,
      limite,
    );
    return filas.map((f) => ({
      ci: f.ci,
      nombre: f.nombre,
      visitas: Number(f.visitas),
    }));
  }

  async leerRenovacion(
    gymId: string,
    id: string,
    hoy: Date,
  ): Promise<FilaRenovacionCartera> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ renovaciones: bigint | number; terminadas: bigint | number }>
    >(
      // Se mira la historia contractual de los socios que pasaron por él, no
      // solo la membresía que tenía asignada: renovar con otro plan sigue
      // siendo una renovación que él ayudó a conseguir.
      // «Terminada» se decide por la FECHA, no por el estado: `estado` nunca
      // dice VENCIDA —registra el acto (se activó, se pausó, se canceló), no la
      // cobertura, que se deriva de las fechas—. Contar estados inexistentes
      // dejaba el denominador en cero y todos los entrenadores salían con un
      // 100 % de retención que no había ganado nadie.
      `SELECT
         SUM(CASE WHEN m.origen = 'RENOVACION' THEN 1 ELSE 0 END) AS renovaciones,
         SUM(CASE
               WHEN m.estado = 'CANCELADA'
                 OR (m.fecha_fin <= ? AND m.estado <> 'PAUSADA')
               THEN 1 ELSE 0 END) AS terminadas
       FROM membresia_cliente m
      WHERE m.gym_id = ? AND m.is_deleted = 0
        AND m.ci IN (
          SELECT DISTINCT m2.ci
            FROM membresia_entrenador_asignacion a
            JOIN membresia_cliente m2 ON m2.membresia_id = a.membresia_id
           WHERE a.id_entrenador = ? AND a.gym_id = ? AND a.is_deleted = 0
        )`,
      hoy,
      gymId,
      id,
      gymId,
    );
    const fila = filas[0];
    return {
      renovaciones: Number(fila?.renovaciones ?? 0),
      terminadas: Number(fila?.terminadas ?? 0),
    };
  }

  async leerIngresos(gymId: string, id: string): Promise<FilaIngresoMoneda[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ moneda_id: string; cobros: bigint | number; total: number | null }>
    >(
      `SELECT moneda_id, COUNT(*) AS cobros, SUM(monto_total) AS total
         FROM pago_cliente
        WHERE id_entrenador = ? AND gym_id = ? AND is_deleted = 0
        GROUP BY moneda_id`,
      id,
      gymId,
    );
    return filas.map((f) => ({
      moneda_id: f.moneda_id,
      cobros: Number(f.cobros),
      total: Number(f.total ?? 0),
    }));
  }
}
