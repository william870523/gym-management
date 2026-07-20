import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_GYM_ID,
  installDemoExchangeRevaluation,
  removeDemoExchangeRevaluation,
} from "../../scripts/demo-exchange-revaluation";

try {
  const gym = await prisma.gym.findUnique({ where: { gym_id: DEMO_GYM_ID } });
  if (!gym) throw new Error(`No existe el gimnasio remoto ${DEMO_GYM_ID}.`);

  const remove = process.argv.includes("--remove");
  if (remove) {
    await removeDemoExchangeRevaluation(prisma, DEMO_GYM_ID);
    console.log("Fixture remota de revaluación cambiaria eliminada.");
  } else {
    await installDemoExchangeRevaluation(prisma, DEMO_GYM_ID);
  }
} finally {
  await prisma.$disconnect();
}
