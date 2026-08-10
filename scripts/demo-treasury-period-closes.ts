import { prisma } from "../src/infrastructure/db/prismaClient";
import { DEMO_GYM_ID } from "../../scripts/demo-payment-collector";
import { installDemoTreasuryPeriodCloses, printDemoTreasuryPeriodCloses, removeDemoTreasuryPeriodCloses } from "../../scripts/demo-treasury-period-closes";
const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;
try { const result = process.argv.includes("--remove") ? await removeDemoTreasuryPeriodCloses(prisma, gymId) : await installDemoTreasuryPeriodCloses(prisma, gymId); printDemoTreasuryPeriodCloses(result); }
finally { await prisma.$disconnect(); }
