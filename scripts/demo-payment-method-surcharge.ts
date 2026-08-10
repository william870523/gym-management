import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  R51_GYM_ID,
  installDemoPaymentMethodSurcharge,
  removeDemoPaymentMethodSurcharge,
} from "../../scripts/demo-payment-method-surcharge";

try {
  if (process.argv.includes("--remove")) {
    await removeDemoPaymentMethodSurcharge(prisma, R51_GYM_ID);
    console.log("Fixture remota R5.1 eliminada.");
  } else await installDemoPaymentMethodSurcharge(prisma, R51_GYM_ID);
} finally { await prisma.$disconnect(); }
