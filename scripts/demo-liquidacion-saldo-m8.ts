/** Instala, verifica o retira la fixture M8 en SQLite. Gemela del concentrador. */
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  installDemoLiquidacionSaldoM8,
  removeDemoLiquidacionSaldoM8,
  verifyDemoLiquidacionSaldoM8,
} from "../../scripts/demo-liquidacion-saldo-m8";

const modo = process.argv.includes("--remove")
  ? "remove"
  : process.argv.includes("--verify")
    ? "verify"
    : "install";

const antes = await prisma.syncLog.count();
try {
  if (modo === "verify") {
    const v = await verifyDemoLiquidacionSaldoM8(prisma);
    console.log(
      `M8 remota · liquidaciones ${v.liquidaciones} (${v.anuladas} anulada) · ` +
        `asientos ${v.asientos} · neto deshecho ${v.netoDeshecho}`,
    );
  } else if (modo === "remove") {
    const r = await removeDemoLiquidacionSaldoM8(prisma);
    console.log(
      `M8 remota retirada · liquidaciones ${r.liquidaciones} · asientos ${r.asientos}`,
    );
  } else {
    const r = await installDemoLiquidacionSaldoM8(prisma);
    console.log(
      `M8 remota · liquidaciones ${r.liquidaciones} (${r.anuladas} anulada) · ` +
        `sede deudora ${r.sedeDeudora}`,
    );
  }
  const despues = await prisma.syncLog.count();
  console.log(`eventos generados ${despues - antes}`);
} finally {
  await prisma.$disconnect();
}
