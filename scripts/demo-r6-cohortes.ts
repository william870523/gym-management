import { trustedClock } from "../src/config/trusted-clock";
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_E3B_GYM_ID,
  installDemoR6Cohortes,
  printDemoR6Cohortes,
  removeDemoR6Cohortes,
} from "../../scripts/demo-r6-cohortes";

const gymId = process.env.DEMO_GYM_ID ?? DEMO_E3B_GYM_ID;
try {
  if (process.argv.includes("--remove")) {
    const result = await removeDemoR6Cohortes(prisma);
    console.log(
      `Fixture E3-b remota retirada: ${result.removed} identificadores.`,
    );
  } else {
    printDemoR6Cohortes(
      await installDemoR6Cohortes(prisma, gymId, trustedClock.nowUtc()),
    );
  }
} finally {
  await prisma.$disconnect();
}
