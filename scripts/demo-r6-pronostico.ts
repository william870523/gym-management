import { trustedClock } from "../src/config/trusted-clock";
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_E5_GYM_ID,
  installDemoR6Pronostico,
  removeDemoR6Pronostico,
  summarizeDemoR6Pronostico,
} from "../../scripts/demo-r6-pronostico";

try {
  const result = process.argv.includes("--remove")
    ? await removeDemoR6Pronostico(prisma, DEMO_E5_GYM_ID)
    : process.argv.includes("--check")
    ? await summarizeDemoR6Pronostico(prisma, DEMO_E5_GYM_ID)
    : await installDemoR6Pronostico(prisma, DEMO_E5_GYM_ID, trustedClock.nowUtc());
  console.log(JSON.stringify(result, null, 2));
} finally {
  await prisma.$disconnect();
}

