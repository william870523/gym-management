import { calendarioLocal } from "../../application/reporting/calendario-estadisticas";
import type {
  EstadisticasPronosticoReader,
  LecturaPronostico,
} from "../../application/reporting/estadisticas-pronostico.reader";
import { prisma } from "../db/prismaClient";

export const TOPE_ENTRADAS_PRONOSTICO = 200_000;
const DIA_MS = 86_400_000;

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

export class PrismaEstadisticasPronosticoReader
  implements EstadisticasPronosticoReader
{
  async leerVisitasDiarias(input: {
    gymId: string;
    zona: string;
    desdeDia: Date;
    hastaDiaExclusivo: Date;
  }): Promise<LecturaPronostico> {
    const desdeAmplio = new Date(input.desdeDia.getTime() - DIA_MS);
    const hastaAmplio = new Date(input.hastaDiaExclusivo.getTime() + DIA_MS);
    const [filas, primera] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ instante: unknown }>>(
        `SELECT a.created_at AS instante
           FROM asistencia a
           JOIN cliente c ON c.ci = a.ci AND c.is_deleted = 0
          WHERE a.gym_id = ? AND a.is_deleted = 0
            AND a.created_at >= ? AND a.created_at < ?
          ORDER BY a.created_at ASC
          LIMIT ${TOPE_ENTRADAS_PRONOSTICO + 1}`,
        input.gymId,
        desdeAmplio,
        hastaAmplio,
      ),
      prisma.$queryRawUnsafe<Array<{ instante: unknown }>>(
        `SELECT MIN(a.created_at) AS instante
           FROM asistencia a
           JOIN cliente c ON c.ci = a.ci AND c.is_deleted = 0
          WHERE a.gym_id = ? AND a.is_deleted = 0`,
        input.gymId,
      ),
    ]);

    const truncado = filas.length > TOPE_ENTRADAS_PRONOSTICO;
    const desde = input.desdeDia.toISOString().slice(0, 10);
    const hasta = input.hastaDiaExclusivo.toISOString().slice(0, 10);
    const conteo = new Map<string, number>();
    for (const fila of filas.slice(0, TOPE_ENTRADAS_PRONOSTICO)) {
      const fecha = aFecha(fila.instante);
      if (fecha === null) continue;
      const dia = calendarioLocal(fecha, input.zona).dia;
      if (dia < desde || dia >= hasta) continue;
      conteo.set(dia, (conteo.get(dia) ?? 0) + 1);
    }

    const primeraFecha = aFecha(primera[0]?.instante);
    return {
      visitasPorDia: [...conteo.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dia, visitas]) => ({ dia, visitas })),
      primeraEntradaDia: primeraFecha === null
        ? null
        : calendarioLocal(primeraFecha, input.zona).dia,
      truncado,
    };
  }
}

