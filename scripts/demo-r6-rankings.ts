import { trustedClock } from "../src/config/trusted-clock";
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_R6_GYM_ID,
  installDemoR6Rankings,
  printDemoR6Rankings,
  removeDemoR6Rankings,
} from "../../scripts/demo-r6-rankings";

const gymId = process.env.DEMO_GYM_ID ?? DEMO_R6_GYM_ID;
try {
  if (process.argv.includes("--remove")) {
    const result = await removeDemoR6Rankings(prisma);
    console.log(`Fixture R6 remota retirada: ${result.removed} identificadores.`);
  } else {
    printDemoR6Rankings(
      await installDemoR6Rankings(prisma, gymId, trustedClock.nowUtc()),
    );
  }
} finally {
  await prisma.$disconnect();
}
