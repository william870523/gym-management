import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_GYM_ID,
  DEMO_HISTORY_ATTENDANCE_IDS,
  installDemoAttendanceHistory,
  removeDemoAttendanceHistory,
} from "../../scripts/demo-attendance-history";

try {
  const gym = await prisma.gym.findUnique({ where: { gym_id: DEMO_GYM_ID } });
  if (!gym) throw new Error(`No existe el gimnasio remoto ${DEMO_GYM_ID}.`);

  if (process.argv.includes("--remove")) {
    await removeDemoAttendanceHistory(prisma);
    console.log("Fixture remota de historial de asistencia eliminada.");
  } else {
    const installed = await installDemoAttendanceHistory(prisma, DEMO_GYM_ID);
    const rows = await prisma.asistencia.findMany({
      where: { asistencia_id: { in: [...DEMO_HISTORY_ATTENDANCE_IDS] } },
      orderBy: { created_at: "asc" },
      select: {
        asistencia_id: true,
        ci: true,
        created_at: true,
        fecha_salida: true,
        pausa_ms: true,
      },
    });
    console.log(JSON.stringify({ ...installed, rows }, null, 2));
  }
} finally {
  await prisma.$disconnect();
}
