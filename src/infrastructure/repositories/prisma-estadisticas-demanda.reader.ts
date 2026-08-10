/**
 * Mapa de demanda día × hora, sobre MariaDB.
 *
 * La agregación **no** se hace en SQL a propósito, igual que en el gemelo
 * SQLite: agrupar por hora exige proyectar cada instante a la zona de la sede, y
 * hacerlo en el motor obligaría a confiar en sus tablas de zonas horarias, que
 * ni están garantizadas ni tienen por qué coincidir con las del otro motor. Dos
 * bases que respondan horas distintas al mismo dato es exactamente lo que la
 * paridad no puede permitirse. Así que se leen los instantes y se proyectan uno
 * a uno con `Intl`, la misma implementación en las dos APIs (§8 del plan).
 *
 * Gemelo: `sqlite-estadisticas-demanda.reader.ts`.
 */
import { prisma } from "../db/prismaClient";
import { calendarioLocal } from "../../application/reporting/calendario-estadisticas";
import { franjaDe } from "../../application/reporting/estadisticas-socio.service";
import type {
  CeldaDemanda,
  EstadisticasDemandaReader,
  FranjaSocio,
  LecturaDemanda,
} from "../../application/reporting/estadisticas-demanda.reader";

/** Tope de entradas leídas por consulta. Rozarlo se declara, no se esconde. */
export const TOPE_ENTRADAS_DEMANDA = 200_000;

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

interface Acumulado {
  visitas: number;
  socios: Set<string>;
}

export class PrismaEstadisticasDemandaReader
  implements EstadisticasDemandaReader
{
  async leerDemanda(input: {
    gymId: string;
    zona: string;
    desde: Date;
    hastaExclusiva: Date;
  }): Promise<LecturaDemanda> {
    const entradas = await prisma.$queryRawUnsafe<
      Array<{ ci: string; instante: unknown; salida: unknown }>
    >(
      `SELECT a.ci AS ci, a.created_at AS instante, a.fecha_salida AS salida
         FROM asistencia a
         JOIN cliente c ON c.ci = a.ci AND c.is_deleted = 0
        WHERE a.gym_id = ? AND a.is_deleted = 0
          AND a.created_at >= ? AND a.created_at < ?
        ORDER BY a.created_at ASC
        LIMIT ${TOPE_ENTRADAS_DEMANDA + 1}`,
      input.gymId,
      input.desde,
      input.hastaExclusiva,
    );

    const truncado = entradas.length > TOPE_ENTRADAS_DEMANDA;
    const filas = truncado
      ? entradas.slice(0, TOPE_ENTRADAS_DEMANDA)
      : entradas;

    const celdas = new Map<string, Acumulado>();
    const sociosDistintos = new Set<string>();
    const franjasPorSocio = new Map<string, Map<string, number>>();
    const visitasPorSocio = new Map<string, number>();
    let sinInstante = 0;
    let abiertas = 0;

    for (const fila of filas) {
      const instante = aFecha(fila.instante);
      if (instante === null) {
        sinInstante += 1;
        continue;
      }
      if (aFecha(fila.salida) === null) abiertas += 1;

      const ci = String(fila.ci);
      const local = calendarioLocal(instante, input.zona);
      const clave = `${local.diaSemana}|${local.hora}`;
      const celda = celdas.get(clave) ?? { visitas: 0, socios: new Set() };
      celda.visitas += 1;
      celda.socios.add(ci);
      celdas.set(clave, celda);

      sociosDistintos.add(ci);
      visitasPorSocio.set(ci, (visitasPorSocio.get(ci) ?? 0) + 1);
      const franja = franjaDe(local.hora);
      const conteo = franjasPorSocio.get(ci) ?? new Map<string, number>();
      conteo.set(franja, (conteo.get(franja) ?? 0) + 1);
      franjasPorSocio.set(ci, conteo);
    }

    // El padrón entero, no solo quien vino: hace falta para poder decir cuántos
    // declararon franja y no aparecieron, que es la mitad del cruce (regla 9).
    const padron = await prisma.$queryRawUnsafe<
      Array<{
        ci: string;
        nombre: string;
        hora_inicio: number | null;
        nombre_horario: string | null;
      }>
    >(
      `SELECT c.ci AS ci,
              CONCAT(c.nombres, ' ', c.apellidos) AS nombre,
              h.hora_inicio AS hora_inicio,
              h.nombre_horario AS nombre_horario
         FROM cliente c
         LEFT JOIN horario h ON h.horario_id = c.id_horarios
                            AND h.is_deleted = 0
        WHERE c.gym_id = ? AND c.is_deleted = 0`,
      input.gymId,
    );

    const franjaPorSocio: FranjaSocio[] = padron.map((fila) => {
      const ci = String(fila.ci);
      const conteo = franjasPorSocio.get(ci);
      return {
        ci,
        nombre: String(fila.nombre ?? ci).trim(),
        horarioNombre: fila.nombre_horario ?? null,
        horarioHoraInicio: fila.hora_inicio === null ||
            fila.hora_inicio === undefined
          ? null
          : Number(fila.hora_inicio),
        franjaObservada: conteo === undefined ? null : dominante(conteo),
        visitas: visitasPorSocio.get(ci) ?? 0,
      };
    });

    const salida: CeldaDemanda[] = [...celdas.entries()].map(
      ([clave, acumulado]) => {
        const [diaSemana, hora] = clave.split("|").map(Number);
        return {
          diaSemana: diaSemana!,
          hora: hora!,
          visitas: acumulado.visitas,
          socios: acumulado.socios.size,
        };
      },
    );

    return {
      celdas: salida,
      visitas: filas.length - sinInstante,
      socios: sociosDistintos.size,
      sinInstante,
      abiertas,
      truncado,
      franjaPorSocio,
    };
  }
}

/**
 * Franja en la que el socio vino más veces.
 *
 * Los empates se rompen por nombre para que dos lecturas seguidas den lo mismo:
 * una franja «dominante» que baile entre consultas es peor que no tenerla.
 */
function dominante(conteo: Map<string, number>): string | null {
  let mejor: string | null = null;
  let mayor = 0;
  for (const [franja, visitas] of [...conteo.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (visitas > mayor) {
      mayor = visitas;
      mejor = franja;
    }
  }
  return mejor;
}
