import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_GYM_ID,
  installDemoClientCreatePaymentData,
  printDemoClientCreatePayment,
  removeDemoClientCreatePaymentData,
} from "../../scripts/demo-client-create-payment";

const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;
try {
  if (process.argv.includes("--remove")) {
    console.log("Fixture remota retirada:", await removeDemoClientCreatePaymentData(prisma));
  } else {
    printDemoClientCreatePayment(await installDemoClientCreatePaymentData(prisma, gymId));
  }
} finally {
  await prisma.$disconnect();
}
