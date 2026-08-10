import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  CERTIFICATION_GYM_ID,
  installCertificationUsers,
  printCertificationUsers,
  removeCertificationUsers,
} from "../../scripts/demo-certification-users";

const gymId = process.env.DEMO_GYM_ID ?? CERTIFICATION_GYM_ID;

try {
  if (process.argv.includes("--remove")) {
    const result = await removeCertificationUsers(prisma, gymId);
    console.log(`Credenciales remotas deshabilitadas: ${result.disabled}.`);
    console.log("Cola de sync: sin cambios.");
  } else {
    printCertificationUsers(await installCertificationUsers(prisma, gymId));
  }
} finally {
  await prisma.$disconnect();
}
