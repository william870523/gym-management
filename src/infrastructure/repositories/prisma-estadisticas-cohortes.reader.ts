/**
 * Altas para las cohortes, sobre MariaDB.
 *
 * Aquí solo se lee **cuándo entró** cada socio. Quién se quedó y quién se fue lo
 * decide el motor canónico de retención, al que se pregunta por otro puerto
 * (`RetencionHistoriaReader`): este lector no sabe nada de supervivencia y no
 * debe saberlo.
 *
 * `fecha_inicio` es un **día de calendario canónico a 00:00Z** y no se proyecta
 * a la zona de la sede: desplazarlo movería contratos de mes. Frente al gemelo
 * SQLite cambian dos cosas del dialecto —`CONCAT` en vez de `||` y el `GROUP BY`
 * completo que exige `ONLY_FULL_GROUP_BY`—, nunca la semántica.
 *
 * Gemelo: `sqlite-estadisticas-cohortes.reader.ts`.
 */
import { prisma } from "../db/prismaClient";
import type {
  AltaCohorte,
  EstadisticasCohortesReader,
} from "../../application/reporting/estadisticas-cohortes.reader";

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

export class PrismaEstadisticasCohortesReader
  implements EstadisticasCohortesReader
{
  async leerAltas(input: {
    gymId: string;
    desde: Date;
    hastaExclusiva: Date;
  }): Promise<AltaCohorte[]> {
    // La cohorte es la de la PRIMERA alta del socio, la de toda su historia. Por
    // eso el `MIN` se calcula sin filtrar por período y la ventana se aplica
    // después, en el `HAVING`: quien entró hace dos años y volvió a darse de
    // alta ayer no pertenece a la cohorte de ayer.
    const filas = await prisma.$queryRawUnsafe<
      Array<{ ci: string; nombre: string; dia: unknown }>
    >(
      `SELECT m.ci AS ci,
              CONCAT(c.nombres, ' ', c.apellidos) AS nombre,
              MIN(m.fecha_inicio) AS dia
         FROM membresia_cliente m
         JOIN cliente c ON c.ci = m.ci AND c.is_deleted = 0
        WHERE m.gym_id = ? AND m.is_deleted = 0 AND m.origen = 'ALTA'
        GROUP BY m.ci, c.nombres, c.apellidos
       HAVING MIN(m.fecha_inicio) >= ? AND MIN(m.fecha_inicio) < ?
        ORDER BY dia ASC, m.ci ASC`,
      input.gymId,
      input.desde,
      input.hastaExclusiva,
    );

    return filas.flatMap((fila) => {
      const dia = aFecha(fila.dia);
      if (dia === null) return [];
      return [{
        ci: String(fila.ci),
        nombre: String(fila.nombre ?? fila.ci).trim(),
        dia: dia.toISOString().slice(0, 10),
      }];
    });
  }

  async contarSociosSinAlta(gymId: string): Promise<number> {
    const filas = await prisma.$queryRawUnsafe<Array<{ total: unknown }>>(
      `SELECT COUNT(*) AS total
         FROM cliente c
        WHERE c.gym_id = ? AND c.is_deleted = 0
          AND NOT EXISTS (
                SELECT 1 FROM membresia_cliente m
                 WHERE m.ci = c.ci
                   AND m.gym_id = c.gym_id
                   AND m.is_deleted = 0
                   AND m.origen = 'ALTA')`,
      gymId,
    );
    return Number(filas[0]?.total ?? 0);
  }
}
