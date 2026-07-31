/**
 * Implementación MariaDB del perfil del plan.
 *
 * MariaDB y el proceso operan en UTC. Las fechas de contrato son días
 * canónicos codificados a 00:00Z —no se desplazan de zona— y toda comparación
 * con «hoy» recibe ese mismo día canónico.
 */
import { prisma } from "../db/prismaClient";
import {
  mesCanonico,
} from "../../application/reporting/calendario-estadisticas";
import { atribuirVisitasAPlan } from "../../application/reporting/atribucion-visitas-plan";
import type {
  EstadisticasPlanReader,
  FilaConteo,
  FilaDuracionPlan,
  FilaEstadoPlan,
  FilaIngresoPlan,
} from "../../application/reporting/estadisticas-plan.reader";

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

/**
 * Contrato inmediatamente anterior del mismo socio.
 *
 * Es la pieza de la matriz de cambio de plan: nadie guarda «de qué plan venía»,
 * así que se reconstruye buscando el contrato con la mayor `fecha_inicio` que
 * sea anterior a la del contrato actual.
 */
const ANTERIOR = `
  SELECT prev.id_planes_pago
    FROM membresia_cliente prev
   WHERE prev.ci = m.ci
     AND prev.gym_id = m.gym_id
     AND prev.is_deleted = 0
     AND prev.fecha_inicio < m.fecha_inicio
   ORDER BY prev.fecha_inicio DESC
   LIMIT 1`;

export class PrismaEstadisticasPlanReader implements EstadisticasPlanReader {
  async leerPlan(gymId: string, id: string) {
    const filas = await prisma.$queryRawUnsafe<
      Array<{
        id_planes_pago: string;
        nombre_plan_pago: string | null;
        importe_plan_pago: number;
        moneda_id: string;
        duracion_plan_pago: number;
        activo: number | boolean;
        incluye_entrenador: number | boolean;
        acepta_cuotas: number | boolean;
        codigo: string | null;
      }>
    >(
      `SELECT id_planes_pago, nombre_plan_pago, importe_plan_pago, moneda_id,
              duracion_plan_pago, activo, incluye_entrenador, acepta_cuotas,
              codigo
         FROM planes_pago
        WHERE id_planes_pago = ? AND gym_id = ? AND is_deleted = 0`,
      id,
      gymId,
    );
    const fila = filas[0];
    if (!fila) return null;
    return {
      id: fila.id_planes_pago,
      nombre: fila.nombre_plan_pago ?? "Sin nombre",
      importe: Number(fila.importe_plan_pago),
      monedaId: fila.moneda_id,
      duracionDias: Number(fila.duracion_plan_pago),
      activo: Boolean(fila.activo),
      incluyeEntrenador: Boolean(fila.incluye_entrenador),
      aceptaCuotas: Boolean(fila.acepta_cuotas),
      codigo: fila.codigo,
    };
  }

  async leerEstados(
    gymId: string,
    id: string,
    hoy: Date,
  ): Promise<FilaEstadoPlan> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{
        vigentes: bigint | number;
        pendientes: bigint | number;
        pausadas: bigint | number;
        terminadas: bigint | number;
        socios: bigint | number;
      }>
    >(
      // La vigencia se DERIVA de la fecha: el estado guardado nunca dice
      // VENCIDA, así que filtrar por él dejaría todo en cero.
      `SELECT
         SUM(CASE WHEN estado = 'ACTIVA' AND fecha_fin > ? THEN 1 ELSE 0 END) AS vigentes,
         SUM(CASE WHEN estado = 'PENDIENTE_PAGO' THEN 1 ELSE 0 END) AS pendientes,
         SUM(CASE WHEN estado = 'PAUSADA' THEN 1 ELSE 0 END) AS pausadas,
         SUM(CASE WHEN estado = 'CANCELADA'
                    OR (fecha_fin <= ? AND estado NOT IN ('PAUSADA','PENDIENTE_PAGO'))
                  THEN 1 ELSE 0 END) AS terminadas,
         COUNT(DISTINCT ci) AS socios
       FROM membresia_cliente
      WHERE id_planes_pago = ? AND gym_id = ? AND is_deleted = 0`,
      hoy,
      hoy,
      id,
      gymId,
    );
    const fila = filas[0];
    return {
      vigentes: Number(fila?.vigentes ?? 0),
      pendientes: Number(fila?.pendientes ?? 0),
      pausadas: Number(fila?.pausadas ?? 0),
      terminadas: Number(fila?.terminadas ?? 0),
      socios: Number(fila?.socios ?? 0),
    };
  }

  async leerContratacionesPorMes(
    gymId: string,
    id: string,
    _zona: string,
  ): Promise<FilaConteo[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ fecha_inicio: unknown }>
    >(
      `SELECT fecha_inicio
         FROM membresia_cliente
        WHERE id_planes_pago = ? AND gym_id = ? AND is_deleted = 0
        ORDER BY fecha_inicio ASC`,
      id,
      gymId,
    );
    const conteo = new Map<string, number>();
    for (const fila of filas) {
      const fecha = aFecha(fila.fecha_inicio);
      if (!fecha) continue;
      const mes = mesCanonico(fecha);
      conteo.set(mes, (conteo.get(mes) ?? 0) + 1);
    }
    return [...conteo.entries()].map(([etiqueta, total]) => ({
      etiqueta,
      total,
    }));
  }

  async leerComposicion(
    gymId: string,
    id: string,
    dimension: "sexo" | "categoria" | "horario" | "entrenador",
    hoy: Date,
  ): Promise<FilaConteo[]> {
    const seleccion = {
      sexo: "c.sexo",
      categoria: "COALESCE(c.categoria, 'SIN CATEGORÍA')",
      horario: "COALESCE(h.nombre_horario, 'Sin franja')",
      entrenador:
        "COALESCE(CONCAT(e.nombres_entrenador, ' ', e.apellidos_entrenador), 'Sin entrenador')",
    }[dimension];
    const joins =
      dimension === "horario"
        ? "LEFT JOIN horario h ON h.horario_id = c.id_horarios"
        : dimension === "entrenador"
          ? "LEFT JOIN entrenadores e ON e.id_entrenador = m.id_entrenador"
          : "";

    const filas = await prisma.$queryRawUnsafe<
      Array<{ etiqueta: string | null; total: bigint | number }>
    >(
      `SELECT ${seleccion} AS etiqueta, COUNT(DISTINCT c.ci) AS total
         FROM membresia_cliente m
         JOIN cliente c ON c.ci = m.ci
         ${joins}
        WHERE m.id_planes_pago = ? AND m.gym_id = ? AND m.is_deleted = 0
          AND c.is_deleted = 0
          AND m.estado = 'ACTIVA' AND m.fecha_fin > ?
        GROUP BY etiqueta
        ORDER BY total DESC`,
      id,
      gymId,
      hoy,
    );
    return filas.map((f) => ({
      etiqueta: f.etiqueta ?? "—",
      total: Number(f.total),
    }));
  }

  async leerVienenDe(gymId: string, id: string): Promise<FilaConteo[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ etiqueta: string | null; total: bigint | number }>
    >(
      `SELECT COALESCE(p.nombre_plan_pago, 'Desconocido') AS etiqueta,
              COUNT(*) AS total
         FROM membresia_cliente m
         LEFT JOIN planes_pago p ON p.id_planes_pago = (${ANTERIOR})
        WHERE m.id_planes_pago = ? AND m.gym_id = ? AND m.is_deleted = 0
          AND (${ANTERIOR}) IS NOT NULL
          AND (${ANTERIOR}) <> m.id_planes_pago
        GROUP BY etiqueta
        ORDER BY total DESC`,
      id,
      gymId,
    );
    return filas.map((f) => ({
      etiqueta: f.etiqueta ?? "Desconocido",
      total: Number(f.total),
    }));
  }

  async leerSeVanA(gymId: string, id: string): Promise<FilaConteo[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ etiqueta: string | null; total: bigint | number }>
    >(
      // El espejo del anterior: contratos de origen CAMBIO cuyo contrato
      // previo era este plan, agrupados por el plan al que fueron.
      `SELECT COALESCE(p.nombre_plan_pago, 'Desconocido') AS etiqueta,
              COUNT(*) AS total
         FROM membresia_cliente m
         LEFT JOIN planes_pago p ON p.id_planes_pago = m.id_planes_pago
        WHERE m.gym_id = ? AND m.is_deleted = 0
          AND (${ANTERIOR}) = ?
          AND m.id_planes_pago <> ?
        GROUP BY etiqueta
        ORDER BY total DESC`,
      gymId,
      id,
      id,
    );
    return filas.map((f) => ({
      etiqueta: f.etiqueta ?? "Desconocido",
      total: Number(f.total),
    }));
  }

  async leerRenovacion(gymId: string, id: string, hoy: Date) {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ renovaciones: bigint | number; terminadas: bigint | number }>
    >(
      `SELECT
         SUM(CASE WHEN origen = 'RENOVACION' THEN 1 ELSE 0 END) AS renovaciones,
         SUM(CASE WHEN estado = 'CANCELADA'
                    OR (fecha_fin <= ? AND estado <> 'PAUSADA')
                  THEN 1 ELSE 0 END) AS terminadas
       FROM membresia_cliente
      WHERE id_planes_pago = ? AND gym_id = ? AND is_deleted = 0`,
      hoy,
      id,
      gymId,
    );
    const fila = filas[0];
    return {
      renovaciones: Number(fila?.renovaciones ?? 0),
      terminadas: Number(fila?.terminadas ?? 0),
    };
  }

  async leerIngresos(gymId: string, id: string): Promise<FilaIngresoPlan[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{
        moneda_id: string;
        cobros: bigint | number;
        total: number | null;
        descuento: number | null;
      }>
    >(
      `SELECT moneda_id,
              COUNT(*) AS cobros,
              SUM(monto_total) AS total,
              SUM(COALESCE(descuento_monto_snapshot, 0)) AS descuento
         FROM pago_cliente
        WHERE id_planes_pago = ? AND gym_id = ? AND is_deleted = 0
        GROUP BY moneda_id`,
      id,
      gymId,
    );

    // El recargo vive en el detalle, no en la cabecera: se suma aparte y se
    // asocia por la moneda del cobro.
    const recargos = await prisma.$queryRawUnsafe<
      Array<{ moneda_id: string; recargo: number | null }>
    >(
      `SELECT p.moneda_id AS moneda_id,
              SUM(CAST(d.recargo_mora_importe AS DECIMAL(18,2))) AS recargo
         FROM detalle_pago d
         JOIN pago_cliente p ON p.pago_cliente_id = d.pago_cliente_id
        WHERE p.id_planes_pago = ? AND p.gym_id = ? AND p.is_deleted = 0
          AND d.is_deleted = 0 AND d.recargo_mora_importe IS NOT NULL
        GROUP BY p.moneda_id`,
      id,
      gymId,
    );
    const porMoneda = new Map(
      recargos.map((r) => [r.moneda_id, Number(r.recargo ?? 0)]),
    );

    return filas.map((f) => ({
      moneda_id: f.moneda_id,
      cobros: Number(f.cobros),
      total: Number(f.total ?? 0),
      descuentoTotal: Number(f.descuento ?? 0),
      recargoTotal: porMoneda.get(f.moneda_id) ?? 0,
    }));
  }

  async leerDuracion(gymId: string, id: string): Promise<FilaDuracionPlan> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ contratada: number | null; real_media: number | null }>
    >(
      // La duración real puede superar a la contratada: una pausa desplaza el
      // fin de cobertura. Verlas juntas es lo que revela cuánto se congela.
      `SELECT
         (SELECT duracion_plan_pago FROM planes_pago
           WHERE id_planes_pago = ?) AS contratada,
         AVG(TIMESTAMPDIFF(SECOND, fecha_inicio, fecha_fin) / 86400.0) AS real_media
       FROM membresia_cliente
      WHERE id_planes_pago = ? AND gym_id = ? AND is_deleted = 0`,
      id,
      id,
      gymId,
    );
    const fila = filas[0];
    return {
      contratada: Number(fila?.contratada ?? 0),
      realMedia:
        fila?.real_media === null || fila?.real_media === undefined
          ? null
          : Math.round(Number(fila.real_media) * 10) / 10,
    };
  }

  async leerUso(gymId: string, id: string, zona: string, _hoy: Date) {
    const membresias = await prisma.$queryRawUnsafe<
      Array<{ ci: string; fecha_inicio: unknown; fecha_fin: unknown }>
    >(
      `SELECT ci, fecha_inicio, fecha_fin
         FROM membresia_cliente
        WHERE id_planes_pago = ? AND gym_id = ? AND is_deleted = 0`,
      id,
      gymId,
    );

    const visitas = await prisma.$queryRawUnsafe<
      Array<{ asistencia_id: string; ci: string; created_at: unknown }>
    >(
      `SELECT asistencia_id, ci, created_at
         FROM asistencia
        WHERE gym_id = ? AND is_deleted = 0
          AND ci IN (
            SELECT DISTINCT ci
              FROM membresia_cliente
             WHERE id_planes_pago = ? AND gym_id = ? AND is_deleted = 0
          )`,
      gymId,
      id,
      gymId,
    );

    return atribuirVisitasAPlan(
      membresias.flatMap((membresia) => {
        const desde = aFecha(membresia.fecha_inicio);
        const hasta = aFecha(membresia.fecha_fin);
        return desde && hasta
          ? [{ ci: membresia.ci, desde, hasta }]
          : [];
      }),
      visitas.flatMap((visita) => {
        const instante = aFecha(visita.created_at);
        return instante
          ? [{ id: visita.asistencia_id, ci: visita.ci, instante }]
          : [];
      }),
      zona,
    );
  }

  async leerCuotas(gymId: string, id: string) {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ membresias: bigint | number; cuotas: bigint | number }>
    >(
      `SELECT COUNT(DISTINCT c.membresia_id) AS membresias, COUNT(*) AS cuotas
         FROM membresia_cuota c
         JOIN membresia_cliente m ON m.membresia_id = c.membresia_id
        WHERE m.id_planes_pago = ? AND m.gym_id = ? AND m.is_deleted = 0
          AND c.is_deleted = 0`,
      id,
      gymId,
    );
    const fila = filas[0];
    return {
      membresiasConCuotas: Number(fila?.membresias ?? 0),
      cuotas: Number(fila?.cuotas ?? 0),
    };
  }
}
