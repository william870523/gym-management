/**
 * Recorre el cruzador entero contra la base real.
 *
 * Un cruzador se construye pegando piezas de SQL, y eso tiene una trampa: la
 * combinación que nadie probó es la que revienta. Aquí se ejecutan **todas** las
 * dimensiones por **todas** las medidas —las compatibles se consultan de verdad,
 * las imposibles se comprueba que salgan vacías con motivo— y se informa de
 * cualquier error de SQL.
 *
 * Solo lectura. Gemelo: `gym-local-api/scripts/verify-statistics-segmentation.ts`.
 */
import { DEMO_R6_GYM_ID } from "../../scripts/demo-r6-rankings";
import { trustedClock } from "../src/config/trusted-clock";
import { datePartsInZone } from "../src/config/tz";
import {
  DIMENSIONES,
  MEDIDAS,
  DEFINICIONES_MEDIDA,
} from "../src/application/reporting/estadisticas-segmentacion.reader";
import { EstadisticasSegmentacionService } from "../src/application/reporting/estadisticas-segmentacion.service";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { PrismaEstadisticasSegmentacionReader } from "../src/infrastructure/repositories/prisma-estadisticas-segmentacion.reader";

// El remoto es multi-sede: el ámbito no sale de una variable de entorno sino
// del token. Para verificar se fija la sede demo, igual que hace
// `verify-statistics-rankings.ts`.
const gymId = process.env.DEMO_GYM_ID ?? DEMO_R6_GYM_ID;

try {
  const gym = await prisma.gym.findUnique({
    where: { gym_id: gymId },
    select: { timezone: true },
  });
  const zona = gym?.timezone?.trim() || "UTC";
  const partes = datePartsInZone(zona, trustedClock.nowUtc());
  const hoy = new Date(Date.UTC(partes.year, partes.month - 1, partes.day));

  // La moneda de la muestra es la que más se cobra, no la primera del
  // catálogo: filtrar por una moneda sin cobros da cero filas y parece un
  // fallo del cruzador cuando es un dato correcto.
  const usadas = await prisma.$queryRawUnsafe<
    Array<{ moneda_id: string; cobros: bigint | number }>
  >(
    `SELECT moneda_id, COUNT(*) AS cobros
       FROM pago_cliente
      WHERE gym_id = ? AND is_deleted = 0
      GROUP BY moneda_id
      ORDER BY cobros DESC`,
    gymId,
  );
  const monedaId = usadas[0]?.moneda_id;

  const service = new EstadisticasSegmentacionService(
    new PrismaEstadisticasSegmentacionReader(),
  );

  let compatibles = 0;
  let imposibles = 0;
  let conDatos = 0;
  const errores: Array<{ dimension: string; medida: string; error: string }> =
    [];
  const muestras: Array<Record<string, unknown>> = [];

  for (const dimension of DIMENSIONES) {
    for (const medida of MEDIDAS) {
      try {
        const salida = await service.cruzar({
          gymId: gymId,
          zona,
          hoy,
          dimension,
          medida,
          dias: 90,
          monedaId: DEFINICIONES_MEDIDA[medida].dinero && dimension !== "moneda"
            ? monedaId
            : undefined,
        });
        if (!salida.compatible) {
          imposibles += 1;
          if (salida.filas.length > 0) {
            errores.push({
              dimension,
              medida,
              error: "una combinación imposible devolvió filas",
            });
          }
          continue;
        }
        compatibles += 1;
        if (salida.filas.length > 0) conDatos += 1;
        if (
          (dimension === "sexo" && medida === "asistencias") ||
          (dimension === "tipo_pago" && medida === "ingreso") ||
          (dimension === "plan" && medida === "visitasPorSocio") ||
          (dimension === "moneda" && medida === "ingreso") ||
          (dimension === "estado" && medida === "padron")
        ) {
          muestras.push({
            dimension,
            medida,
            total: salida.total,
            filas: salida.filas.slice(0, 4),
          });
        }
      } catch (error: any) {
        errores.push({ dimension, medida, error: String(error?.message ?? error) });
      }
    }
  }

  const csv = await service.exportarCsv({
    gymId: gymId,
    zona,
    hoy,
    dimension: "tipo_pago",
    medida: "ingreso",
    dias: 90,
    monedaId,
  });

  console.log(JSON.stringify({
    base: "MariaDB",
    zona,
    dia_negocio: hoy.toISOString().slice(0, 10),
    combinaciones: {
      totales: DIMENSIONES.length * MEDIDAS.length,
      compatibles,
      imposibles,
      compatiblesConDatos: conDatos,
      errores,
    },
    muestras,
    exportacionCsv: {
      nombreArchivo: csv.nombreArchivo,
      filas: csv.total,
      cabecera: csv.contenido.replace(/^﻿/, "").split("\r\n")[0],
      primera: csv.contenido.replace(/^﻿/, "").split("\r\n")[1] ?? null,
    },
  }, null, 2));

  if (errores.length > 0) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
