import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_GYM_ID,
  installDemoMultiSedeData,
  removeDemoMultiSedeData,
  printDemoMultiSedeExpectations,
} from "../../scripts/demo-multi-sede";

// El remoto no tiene un GYM_ID de instalación: la fixture es del gimnasio de
// demostración y se puede apuntar a otro con DEMO_GYM_ID si hiciera falta.
const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;

try {
  if (process.argv.includes("--remove")) {
    const result = await removeDemoMultiSedeData(prisma);
    console.log(
      `Fixture remota eliminada: ${result.retirados} identificadores DEMO de multi-sede.`,
    );
  } else {
    const result = await installDemoMultiSedeData(prisma, gymId);
    printDemoMultiSedeExpectations(result);
  }
} finally {
  await prisma.$disconnect();
}
