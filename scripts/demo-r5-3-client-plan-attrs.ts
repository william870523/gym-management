import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_CLIENT_VIEJO_CI,
  DEMO_CLIENT_NUEVO_CI,
  DEMO_GYM_ID,
  installDemoR53Data,
  removeDemoR53Data,
} from "../../scripts/demo-r5-3-client-plan-attrs";

try {
  const gym = await prisma.gym.findUnique({ where: { gym_id: DEMO_GYM_ID } });
  if (!gym) throw new Error(`No existe el gimnasio remoto ${DEMO_GYM_ID}.`);

  const remove = process.argv.includes("--remove");
  if (remove) {
    await removeDemoR53Data(prisma, DEMO_GYM_ID);
    console.log(
      `Fixture remota eliminada: ${DEMO_CLIENT_VIEJO_CI} · ${DEMO_CLIENT_NUEVO_CI}`,
    );
  } else {
    await installDemoR53Data(prisma, DEMO_GYM_ID);
    console.log(
      `Fixture remota instalada: ${DEMO_CLIENT_VIEJO_CI} · Socio Antiguo DEMO`,
    );
  }
} finally {
  await prisma.$disconnect();
}
