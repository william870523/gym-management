/** Instala, verifica o retira la fixture M4c en MariaDB. Gemela del escritorio. */
import { prisma } from "../src/infrastructure/db/prismaClient";
import { trustedClock } from "../src/config/trusted-clock";
import {
  installDemoCobroCruzadoM4c,
  removeDemoCobroCruzadoM4c,
  verifyDemoCobroCruzadoM4c,
} from "../../scripts/demo-cobro-cruzado-m4c";

const modo = process.argv.includes("--remove")
  ? "remove"
  : process.argv.includes("--verify")
    ? "verify"
    : "install";

const antes = await prisma.syncLog.count();
try {
  if (modo === "verify") {
    const v = await verifyDemoCobroCruzadoM4c(prisma, trustedClock.nowUtc());
    console.log(
      v.instalada
        ? `M4c remoto · origen ${v.origen} · plan ${v.precioFinal} · ` +
            `atraso ${v.diasAtraso} d · recargo ${v.recargo} · total HOY ${v.total} · ` +
            `foto de hace ${v.antiguedadDias} d`
        : "M4c remoto · sin cotización instalada",
    );
  } else if (modo === "remove") {
    const r = await removeDemoCobroCruzadoM4c(prisma);
    console.log(`M4c remoto retirada · cotizaciones ${r.cotizaciones}`);
  } else {
    const r = await installDemoCobroCruzadoM4c(prisma);
    console.log(
      `M4c remoto · visitante ${r.ci} de ${r.origen} · ${r.plan} · ${r.precioFinal}`,
    );
  }
  console.log(`eventos generados ${(await prisma.syncLog.count()) - antes}`);
} finally {
  await prisma.$disconnect();
}
