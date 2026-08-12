import { prisma } from "../src/infrastructure/db/prismaClient";
import { DEMO_GYM_ID } from "../../scripts/demo-membership-vigencia";
import { installDemoVoluntaryCancellation, printDemoVoluntaryCancellation, removeDemoVoluntaryCancellation } from "../../scripts/demo-voluntary-cancellation";

const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;
try {
  if (process.argv.includes("--remove")) {
    console.log(await removeDemoVoluntaryCancellation(prisma));
  } else {
    printDemoVoluntaryCancellation(await installDemoVoluntaryCancellation(prisma, gymId));
  }
} finally { await prisma.$disconnect(); }
