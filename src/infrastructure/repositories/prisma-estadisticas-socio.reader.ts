/**
 * Implementación MariaDB del perfil estadístico del socio.
 *
 * MariaDB opera en UTC y devuelve Date reales a través de Prisma. La zona del
 * gimnasio se proyecta por instante con `Intl`, porque la sesión UTC no debe
 * decidir qué día u hora comercial vio la sede.
 */
import { prisma } from "../db/prismaClient";
import { calendarioLocal } from "../../application/reporting/calendario-estadisticas";
import type {
  EstadisticasSocioReader,
  FilaAsistenciaDia,
  FilaConteoEtiqueta,
  FilaImportePorMoneda,
  FilaMembresia,
  FilaMoraSocio,
  FilaPeso,
} from "../../application/reporting/estadisticas-socio.reader";

/**
 * Normaliza a `Date` lo que devuelve el SQL crudo.
 *
 * Prisma solo convierte tipos en consultas **tipadas**: en `$queryRaw` una
 * columna DateTime de SQLite llega como el entero epoch que hay guardado, y una
 * agregación como `MIN(fecha)` también. Confiar en que llega un `Date` explota
 * al primer `toISOString()`, y explota en tiempo de ejecución, no al compilar.
 */
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

export class PrismaEstadisticasSocioReader implements EstadisticasSocioReader {
  async leerSocio(gymId: string, ci: string) {
    const filas = await prisma.$queryRawUnsafe<
      Array<{
        ci: string;
        nombres: string;
        apellidos: string;
        sexo: string;
        fecha_nacimiento: unknown;
        estatura_cliente: number | null;
        objetivo: string | null;
        categoria: string | null;
        nacionalidad_id: string | null;
        id_horarios: string | null;
        id_entrenador: string | null;
        created_at: unknown;
      }>
    >(
      `SELECT ci, nombres, apellidos, sexo, fecha_nacimiento, estatura_cliente,
              objetivo, categoria, nacionalidad_id, id_horarios, id_entrenador,
              created_at
         FROM cliente
        WHERE ci = ? AND gym_id = ? AND is_deleted = 0`,
      ci,
      gymId,
    );
    const fila = filas[0];
    if (!fila) return null;
    return {
      ci: fila.ci,
      nombres: fila.nombres,
      apellidos: fila.apellidos,
      sexo: fila.sexo,
      fecha_nacimiento: aFecha(fila.fecha_nacimiento),
      estatura: fila.estatura_cliente,
      objetivo: fila.objetivo,
      categoria: fila.categoria,
      nacionalidad_id: fila.nacionalidad_id,
      id_horarios: fila.id_horarios,
      id_entrenador: fila.id_entrenador,
      creado: aFecha(fila.created_at),
    };
  }

  async leerAsistencias(
    gymId: string,
    ci: string,
    zona: string,
  ): Promise<FilaAsistenciaDia[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ created_at: unknown; minutos: number | null }>
    >(
      `SELECT created_at,
              CASE
                WHEN fecha_salida IS NULL THEN NULL
                ELSE (
                  TIMESTAMPDIFF(MICROSECOND, created_at, fecha_salida) / 1000
                  - COALESCE(pausa_ms, 0)
                ) / 60000.0
              END AS minutos
         FROM asistencia
        WHERE ci = ? AND gym_id = ? AND is_deleted = 0
        ORDER BY created_at ASC`,
      ci,
      gymId,
    );
    return filas.flatMap((fila) => {
      const instante = aFecha(fila.created_at);
      if (!instante) return [];
      const local = calendarioLocal(instante, zona);
      return [{
        dia: local.dia,
        hora: local.hora,
        diaSemana: local.diaSemana,
        minutos:
          fila.minutos === null ? null : Math.round(Number(fila.minutos)),
      }];
    });
  }

  async leerCobrosPorMoneda(
    gymId: string,
    ci: string,
  ): Promise<FilaImportePorMoneda[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{
        moneda_id: string;
        cobros: bigint | number;
        total: number;
        primero: unknown;
        ultimo: unknown;
      }>
    >(
      `SELECT moneda_id,
              COUNT(*) AS cobros,
              SUM(monto_total) AS total,
              MIN(fecha) AS primero,
              MAX(fecha) AS ultimo
         FROM pago_cliente
        WHERE ci = ? AND gym_id = ? AND is_deleted = 0
        GROUP BY moneda_id`,
      ci,
      gymId,
    );
    return filas.map((f) => ({
      moneda_id: f.moneda_id,
      cobros: Number(f.cobros),
      total: Number(f.total ?? 0),
      primero: aFecha(f.primero),
      ultimo: aFecha(f.ultimo),
    }));
  }

  async leerCobrosPorMedio(
    gymId: string,
    ci: string,
  ): Promise<FilaConteoEtiqueta[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ etiqueta: string | null; total: bigint | number }>
    >(
      `SELECT tp.nombre_tipo_pago AS etiqueta, COUNT(*) AS total
         FROM detalle_pago d
         JOIN pago_cliente p ON p.pago_cliente_id = d.pago_cliente_id
         LEFT JOIN tipo_pago tp ON tp.tipo_pago_id = d.tipo_pago_id
        WHERE p.ci = ? AND p.gym_id = ? AND p.is_deleted = 0 AND d.is_deleted = 0
        GROUP BY tp.nombre_tipo_pago
        ORDER BY total DESC`,
      ci,
      gymId,
    );
    return filas.map((f) => ({
      etiqueta: f.etiqueta ?? "Sin medio registrado",
      total: Number(f.total),
    }));
  }

  async leerMora(gymId: string, ci: string): Promise<FilaMoraSocio> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{
        con_recargo: bigint | number;
        recargo_total: number | null;
        dias_promedio: number | null;
      }>
    >(
      `SELECT COUNT(*) AS con_recargo,
              SUM(CAST(d.recargo_mora_importe AS DECIMAL(18,2))) AS recargo_total,
              AVG(d.recargo_mora_dias_atraso) AS dias_promedio
         FROM detalle_pago d
         JOIN pago_cliente p ON p.pago_cliente_id = d.pago_cliente_id
        WHERE p.ci = ? AND p.gym_id = ? AND p.is_deleted = 0 AND d.is_deleted = 0
          AND d.recargo_mora_importe IS NOT NULL
          AND CAST(d.recargo_mora_importe AS DECIMAL(18,2)) > 0`,
      ci,
      gymId,
    );
    const condonado = await prisma.$queryRawUnsafe<
      Array<{ total: number | null }>
    >(
      `SELECT SUM(CAST(recargo_mora_condonado_importe AS DECIMAL(18,2))) AS total
         FROM pago_cliente
        WHERE ci = ? AND gym_id = ? AND is_deleted = 0
          AND recargo_mora_condonado_importe IS NOT NULL`,
      ci,
      gymId,
    );
    const fila = filas[0];
    return {
      cobrosConRecargo: Number(fila?.con_recargo ?? 0),
      recargoTotal: Number(fila?.recargo_total ?? 0),
      diasAtrasoPromedio:
        fila?.dias_promedio === null || fila?.dias_promedio === undefined
          ? null
          : Number(fila.dias_promedio),
      condonadoTotal: Number(condonado[0]?.total ?? 0),
    };
  }

  async leerPesos(gymId: string, ci: string): Promise<FilaPeso[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{ fecha: unknown; peso: number }>
    >(
      `SELECT fecha, peso
         FROM cliente_peso
        WHERE ci = ? AND gym_id = ? AND is_deleted = 0
        ORDER BY fecha ASC`,
      ci,
      gymId,
    );
    return filas
      .map((f) => ({ fecha: aFecha(f.fecha), peso: Number(f.peso) }))
      // Un pesaje sin fecha legible no se grafica: se descarta con su motivo
      // implícito en vez de dibujar un punto en el epoch cero.
      .filter((f): f is { fecha: Date; peso: number } => f.fecha !== null);
  }

  async leerMembresias(gymId: string, ci: string): Promise<FilaMembresia[]> {
    const filas = await prisma.$queryRawUnsafe<
      Array<{
        membresia_id: string;
        plan_nombre_snapshot: string;
        precio_snapshot: number;
        moneda_id: string;
        fecha_inicio: unknown;
        fecha_fin: unknown;
        estado: string;
        origen: string;
        id_entrenador: string | null;
      }>
    >(
      `SELECT membresia_id, plan_nombre_snapshot, precio_snapshot, moneda_id,
              fecha_inicio, fecha_fin, estado, origen, id_entrenador
         FROM membresia_cliente
        WHERE ci = ? AND gym_id = ? AND is_deleted = 0
        ORDER BY fecha_inicio ASC`,
      ci,
      gymId,
    );
    return filas.map((f) => ({
      membresia_id: f.membresia_id,
      plan_nombre: f.plan_nombre_snapshot,
      precio: Number(f.precio_snapshot),
      moneda_id: f.moneda_id,
      fecha_inicio: aFecha(f.fecha_inicio) ?? new Date(0),
      fecha_fin: aFecha(f.fecha_fin) ?? new Date(0),
      estado: f.estado,
      origen: f.origen,
      id_entrenador: f.id_entrenador,
    }));
  }

  async leerDiasPausados(gymId: string, ci: string): Promise<number> {
    const filas = await prisma.$queryRawUnsafe<Array<{ dias: number | null }>>(
      // La pausa no guarda el socio: se llega por su membresía.
      `SELECT SUM(
                CASE
                  WHEN mp.fecha_reanudacion IS NULL THEN 0
                  ELSE TIMESTAMPDIFF(SECOND, mp.fecha_pausa, mp.fecha_reanudacion) / 86400.0
                END
              ) AS dias
         FROM membresia_pausa mp
         JOIN membresia_cliente mc ON mc.membresia_id = mp.membresia_id
        WHERE mc.ci = ? AND mp.gym_id = ? AND mp.is_deleted = 0`,
      ci,
      gymId,
    );
    return Math.round(Number(filas[0]?.dias ?? 0));
  }
}
