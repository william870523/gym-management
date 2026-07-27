import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_GYM_ID,
  installDemoVigenciaData,
  removeDemoVigenciaData,
  printDemoVigenciaExpectations,
} from "../../scripts/demo-membership-vigencia";

// El remoto no tiene un GYM_ID de instalación: la fixture es del gimnasio de
// demostración y se puede apuntar a otro con DEMO_GYM_ID.
const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;

try {
  if (process.argv.includes("--remove")) {
    const result = await removeDemoVigenciaData(prisma);
    console.log(
      `Fixture remota eliminada: ${result.retirados} identificadores DEMO de vigencia.`,
    );
  } else {
    printDemoVigenciaExpectations(await installDemoVigenciaData(prisma, gymId));
  }
} finally {
  await prisma.$disconnect();
}
