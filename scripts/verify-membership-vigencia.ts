/**
 * Verificación reproducible de la vigencia derivada en la **web/remoto**
 * (docs/DEMO_MEMBERSHIP_VIGENCIA.md).
 *
 * Ejercita el app Hono real con un token de verdad. Gemela de la del
 * escritorio: si las dos no dicen lo mismo del mismo socio, la paridad está
 * rota y el gimnasio vería una cosa en la ventana y otra en el navegador.
 *
 * Necesita la fixture instalada:  bun run demo:membership-vigencia
 */
import { prisma } from "../src/infrastructure/db/prismaClient";
import { JwtService } from "../src/infrastructure/auth/jwt.service";
import { app } from "../src/infrastructure/http/server";
import { CASOS, DEMO_GYM_ID } from "../../scripts/demo-membership-vigencia";

let fallos = 0;

async function main() {
  const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;
  const admin = await prisma.user.findFirst({
    where: { gym_id: gymId, active: true, is_deleted: false, role: "admin" },
    select: { user_id: true, user_email: true },
  });
  if (!admin) throw new Error(`No hay administración activa en ${gymId}.`);

  const token = JwtService.signAdminToken({
    userId: admin.user_id,
    role: "admin",
    email: admin.user_email,
    gymId,
  });

  const response = await app.request("http://gymos.test/clientes?limit=200", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status !== 200) {
    throw new Error(`GET /clientes respondió ${response.status}`);
  }
  const cuerpo = await response.json() as any;
  const lista: any[] = Array.isArray(cuerpo) ? cuerpo : (cuerpo.data ?? cuerpo.clientes ?? []);
  const porCi = new Map(lista.map((fila) => [String(fila.ci), fila]));

  console.log("SOCIO         ESTADO GUARDADO  VIGENCIA DERIVADA  CUBRE HOY  DÍAS");
  for (const caso of CASOS) {
    const fila = porCi.get(caso.ci);
    if (!fila) {
      fallos += 1;
      console.log(`${caso.nombre.padEnd(13)} (no llegó en la respuesta)`);
      continue;
    }
    const ok = fila.membresia_vigencia === caso.espera;
    if (!ok) fallos += 1;
    console.log(
      `${caso.nombre.padEnd(13)} ${String(fila.membresia_estado).padEnd(16)} ` +
        `${String(fila.membresia_vigencia).padEnd(18)} ` +
        `${String(fila.membresia_cubre_hoy).padEnd(10)} ` +
        `${fila.membresia_dias_desde_vencimiento ?? "-"}` +
        `${ok ? "" : `   <-- esperaba ${caso.espera}`}`,
    );
  }

  console.log("");
  if (fallos > 0) {
    throw new Error(`VIGENCIA_REMOTA_FAILED: ${fallos} socio(s) en rojo.`);
  }
  console.log("Todas las vigencias coinciden con lo esperado.");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
