/**
 * Recorre las tres superficies de E3-b contra MariaDB: cohortes de alta, mapa
 * de demanda y calidad de datos.
 *
 * Ejecuta los **mismos servicios** que sirven los endpoints remotos, con los
 * lectores Prisma, así que lo que imprime es lo que respondería la API. Solo
 * lectura.
 *
 * Gemelo: `gym-local-api/scripts/verify-statistics-e3b.ts`, con el mismo
 * formato de salida para poder comparar los dos motores línea a línea.
 */
import { trustedClock } from "../src/config/trusted-clock";
import { datePartsInZone } from "../src/config/tz";
import { EstadisticasCohortesService } from "../src/application/reporting/estadisticas-cohortes.service";
import { EstadisticasDemandaService } from "../src/application/reporting/estadisticas-demanda.service";
import { EstadisticasCalidadService } from "../src/application/reporting/estadisticas-calidad.service";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { PrismaEstadisticasCohortesReader } from "../src/infrastructure/repositories/prisma-estadisticas-cohortes.reader";
import { PrismaEstadisticasDemandaReader } from "../src/infrastructure/repositories/prisma-estadisticas-demanda.reader";
import { PrismaEstadisticasCalidadReader } from "../src/infrastructure/repositories/prisma-estadisticas-calidad.reader";
import { RetencionCanonicaDesdeServicio } from "../src/infrastructure/repositories/retencion-canonica.reader";
import { imprimirVerificacionE3B } from "../../scripts/verify-statistics-e3b-report";

const gymId = process.env.DEMO_GYM_ID ?? "local-gym-001";

try {
  const gym = await prisma.gym.findFirst({
    where: { gym_id: gymId },
    select: { timezone: true },
  });
  const zona = gym?.timezone?.trim() || "America/Los_Angeles";
  const partes = datePartsInZone(zona, trustedClock.nowUtc());
  const hoy = new Date(Date.UTC(partes.year, partes.month - 1, partes.day));

  const retencion = new RetencionCanonicaDesdeServicio();
  const cohortes = new EstadisticasCohortesService(
    new PrismaEstadisticasCohortesReader(),
    retencion,
  );
  const demanda = new EstadisticasDemandaService(
    new PrismaEstadisticasDemandaReader(),
  );
  const calidad = new EstadisticasCalidadService(
    new PrismaEstadisticasCalidadReader(),
    retencion,
  );

  await imprimirVerificacionE3B({
    motor: "MariaDB (gym-remote-api)",
    gymId,
    zona,
    hoy,
    cohortes: (dias, granularidad) =>
      cohortes.cohortes({ gymId, zona, hoy, dias, granularidad }),
    demanda: (dias) => demanda.demanda({ gymId, zona, hoy, dias }),
    calidad: (dias) => calidad.calidad({ gymId, zona, hoy, dias }),
  });
} finally {
  await prisma.$disconnect();
}
