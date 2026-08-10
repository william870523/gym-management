import { trustedClock } from "../src/config/trusted-clock";
import { datePartsInZone } from "../src/config/tz";
import { EstadisticasPronosticoService } from "../src/application/reporting/estadisticas-pronostico.service";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { PrismaEstadisticasPronosticoReader } from "../src/infrastructure/repositories/prisma-estadisticas-pronostico.reader";
import { imprimirVerificacionE5 } from "../../scripts/verify-statistics-e5-report";
import { DEMO_E5_GYM_ID } from "../../scripts/demo-r6-pronostico";

try {
  const gym = await prisma.gym.findUnique({ where: { gym_id: DEMO_E5_GYM_ID }, select: { timezone: true } });
  if (!gym?.timezone) throw new Error("La sede E5 no tiene zona horaria.");
  const zona = gym.timezone;
  const parts = datePartsInZone(zona, trustedClock.nowUtc());
  const hoy = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const service = new EstadisticasPronosticoService(new PrismaEstadisticasPronosticoReader());
  await imprimirVerificacionE5({
    motor: "MariaDB (gym-remote-api)",
    obtener: () => service.pronostico({
      gymId: DEMO_E5_GYM_ID,
      zona,
      hoy,
      diasHistoria: 180,
      diasHorizonte: 28,
    }),
  });
} finally {
  await prisma.$disconnect();
}

