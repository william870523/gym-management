import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_GYM_ID,
  installDemoTrainerChange,
  removeDemoTrainerChange,
  printDemoTrainerChangeExpectations,
} from "../../scripts/demo-trainer-change";

// El remoto no tiene un GYM_ID de instalación: la fixture es del gimnasio de
// demostración y se puede apuntar a otro con DEMO_GYM_ID si hiciera falta.
const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;

try {
  if (process.argv.includes("--remove")) {
    const result = await removeDemoTrainerChange(prisma, gymId);
    console.log(`Fixture remota R5.4 eliminada: ${JSON.stringify(result)}.`);
  } else {
    const result = await installDemoTrainerChange(prisma, gymId);
    printDemoTrainerChangeExpectations(result);
  }
} finally {
  await prisma.$disconnect();
}
