/** Instala, verifica o retira la fixture M4b en MariaDB. Gemela del escritorio. */
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  installDemoAccesoMultisedeM4b,
  removeDemoAccesoMultisedeM4b,
  verifyDemoAccesoMultisedeM4b,
} from "../../scripts/demo-acceso-multisede-m4b";

const modo = process.argv.includes("--remove")
  ? "remove"
  : process.argv.includes("--verify")
    ? "verify"
    : "install";

const antes = await prisma.syncLog.count();
try {
  if (modo === "verify") {
    const v = await verifyDemoAccesoMultisedeM4b(prisma);
    console.log(
      `M4b remoto · cobros ${v.cobros} · asientos ${v.asientos} · ` +
        `deuda con la cadena ${JSON.stringify(v.porSede)}`,
    );
  } else if (modo === "remove") {
    const r = await removeDemoAccesoMultisedeM4b(prisma);
    console.log(`M4b remoto retirada · cobros ${r.cobros} · asientos ${r.asientos}`);
  } else {
    const r = await installDemoAccesoMultisedeM4b(prisma);
    console.log(
      `M4b remoto · cobros ${r.cobros} de ${r.importe} · ` +
        `sedes deudoras ${r.sedesDeudoras.join(", ")}`,
    );
  }
  const despues = await prisma.syncLog.count();
  console.log(`eventos generados ${despues - antes}`);
} finally {
  await prisma.$disconnect();
}
