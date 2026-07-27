import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_GYM_ID,
  installDemoRecargoMoraData,
  removeDemoRecargoMoraData,
  printDemoRecargoMoraExpectations,
} from "../../scripts/demo-recargo-mora";

const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;

try {
  const remove = process.argv.includes("--remove");
  if (remove) {
    await removeDemoRecargoMoraData(prisma, gymId);
    console.log("Fixture remota eliminada: planes y clientes DEMO de recargo por mora.");
  } else {
    const result = await installDemoRecargoMoraData(prisma, gymId);
    console.log(`Fixture remota instalada: ${result.planes.length} planes DEMO de recargo por mora.`);
    printDemoRecargoMoraExpectations();
  }
} finally {
  await prisma.$disconnect();
}
