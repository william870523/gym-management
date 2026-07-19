import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_RETENTION_GYM_ID,
  getDemoRetentionYearSummary,
  installDemoRetentionYear,
  removeDemoRetentionYear,
} from "../../scripts/demo-retention-year";

try {
  const remove = process.argv.includes("--remove");
  const check = process.argv.includes("--check");
  const summary = remove
    ? await removeDemoRetentionYear(prisma, DEMO_RETENTION_GYM_ID)
    : check
      ? await getDemoRetentionYearSummary(prisma, DEMO_RETENTION_GYM_ID)
      : await installDemoRetentionYear(prisma, DEMO_RETENTION_GYM_ID);
  console.log(JSON.stringify({ action: remove ? "removed" : check ? "checked" : "installed", ...summary }, null, 2));
} finally {
  await prisma.$disconnect();
}
