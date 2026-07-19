import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_CLIENT_CI,
  DEMO_GYM_ID,
  installDemoClientHistory,
  removeDemoClientHistory,
} from "../../scripts/demo-client-history";

try {
  const gym = await prisma.gym.findUnique({ where: { gym_id: DEMO_GYM_ID } });
  if (!gym) throw new Error(`No existe el gimnasio remoto ${DEMO_GYM_ID}.`);

  const remove = process.argv.includes("--remove");
  if (remove) {
    await removeDemoClientHistory(prisma, DEMO_GYM_ID);
    console.log(`Fixture remota eliminada: ${DEMO_CLIENT_CI}`);
  } else {
    await installDemoClientHistory(prisma, DEMO_GYM_ID);
    console.log(`Fixture remota instalada: ${DEMO_CLIENT_CI} · Marina Historia DEMO`);
  }
} finally {
  await prisma.$disconnect();
}
