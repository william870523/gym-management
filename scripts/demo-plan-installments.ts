import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_GYM_ID,
  installDemoPlanInstallmentsData,
  removeDemoPlanInstallmentsData,
  printDemoPlanInstallmentsExpectations,
} from "../../scripts/demo-plan-installments";

const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;

try {
  const remove = process.argv.includes("--remove");
  if (remove) {
    await removeDemoPlanInstallmentsData(prisma, gymId);
    console.log("Fixture remota eliminada: planes, socios y cuotas DEMO de R5.2.");
  } else {
    const result = await installDemoPlanInstallmentsData(prisma, gymId);
    console.log(
      `Fixture remota instalada: ${result.planes.length} planes por cuotas y ${result.totalMembresias} membresías DEMO.`,
    );
    printDemoPlanInstallmentsExpectations();
  }
} finally {
  await prisma.$disconnect();
}
