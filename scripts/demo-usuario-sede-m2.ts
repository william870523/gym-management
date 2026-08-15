import {
  installDemoUsuarioSedeM2,
  removeDemoUsuarioSedeM2,
} from "../../scripts/demo-usuario-sede-m2";
import { prisma } from "../src/infrastructure/db/prismaClient";

try {
  const result = process.argv.includes("--remove")
    ? await removeDemoUsuarioSedeM2(prisma)
    : await installDemoUsuarioSedeM2(prisma);
  console.log(JSON.stringify({ engine: "mariadb", ...result }, null, 2));
} finally {
  await prisma.$disconnect();
}
