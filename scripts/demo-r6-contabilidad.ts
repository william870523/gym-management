import { trustedClock } from "../src/config/trusted-clock";
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_E4_GYM_ID,
  installDemoR6Contabilidad,
  operation,
  removeDemoR6Contabilidad,
  summarizeDemoR6Contabilidad,
} from "../../scripts/demo-r6-contabilidad";

const gymId = process.env.DEMO_GYM_ID ?? DEMO_E4_GYM_ID;
try {
  const action = operation(process.argv);
  const result = action === "remove"
    ? await removeDemoR6Contabilidad(prisma, gymId)
    : action === "check"
    ? await summarizeDemoR6Contabilidad(prisma, gymId)
    : await installDemoR6Contabilidad(prisma, gymId);
  console.log(JSON.stringify({ ...result, generado_at_utc: trustedClock.nowUtc().toISOString() }, null, 2));
} finally {
  await prisma.$disconnect();
}
