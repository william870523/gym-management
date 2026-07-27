import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_GYM_ID,
  installDemoPaymentCollectorData,
  removeDemoPaymentCollectorData,
  printDemoPaymentCollectorExpectations,
} from "../../scripts/demo-payment-collector";

// El remoto no tiene un GYM_ID de instalación: la fixture es del gimnasio de
// demostración y se puede apuntar a otro con DEMO_GYM_ID si hiciera falta.
const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;

try {
  if (process.argv.includes("--remove")) {
    const result = await removeDemoPaymentCollectorData(prisma, gymId);
    console.log(
      `Fixture remota eliminada: ${result.retirados} identificadores DEMO de R5.6.`,
    );
  } else {
    const result = await installDemoPaymentCollectorData(prisma, gymId);
    printDemoPaymentCollectorExpectations(result);
  }
} finally {
  await prisma.$disconnect();
}
