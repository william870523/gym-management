import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_GYM_ID,
  DEMO_MARGIN_PLAN_NAME,
  installDemoManagementMargin,
  removeDemoManagementMargin,
} from "../../scripts/demo-management-margin";

try {
  const gym = await prisma.gym.findUnique({ where: { gym_id: DEMO_GYM_ID } });
  if (!gym) throw new Error(`No existe el gimnasio remoto ${DEMO_GYM_ID}.`);

  const remove = process.argv.includes("--remove");
  if (remove) {
    await removeDemoManagementMargin(prisma, DEMO_GYM_ID);
    console.log(`Fixture remota eliminada: ${DEMO_MARGIN_PLAN_NAME}`);
  } else {
    await installDemoManagementMargin(prisma, DEMO_GYM_ID);
    console.log(`Fixture remota instalada: ${DEMO_MARGIN_PLAN_NAME}`);
  }
} finally {
  await prisma.$disconnect();
}
