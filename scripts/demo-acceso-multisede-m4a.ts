/** Instala la fixture M4a en MariaDB. Gemela de la del escritorio. */
import { prisma } from "../src/infrastructure/db/prismaClient";
import { installDemoAccesoMultisedeM4a } from "../../scripts/demo-acceso-multisede-m4a";

const antes = await prisma.syncLog.count();
try {
  const r = await installDemoAccesoMultisedeM4a(prisma);
  const despues = await prisma.syncLog.count();
  console.log(
    `M4a remoto · precio ${r.precio} · accesos ${r.accesos} · ` +
      `copias vivas ${r.replicasVivas} · eventos generados ${despues - antes}`,
  );
} finally {
  await prisma.$disconnect();
}
