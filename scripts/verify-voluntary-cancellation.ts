import { randomUUID } from "crypto";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { JwtService } from "../src/infrastructure/auth/jwt.service";
import { app } from "../src/infrastructure/http/server";
import { DEMO_GYM_ID } from "../../scripts/demo-membership-vigencia";
import { DEMO_VOLUNTARY_CASES, voluntaryMembershipId } from "../../scripts/demo-voluntary-cancellation";

try {
  const gymId = process.env.DEMO_GYM_ID ?? DEMO_GYM_ID;
  const user = await prisma.user.findFirst({ where: { gym_id: gymId, active: true, is_deleted: false, role: "admin" }, select: { user_id: true, user_email: true } });
  if (!user) throw new Error("No hay administración remota activa.");
  const token = JwtService.signAdminToken({ userId: user.user_id, role: "admin", email: user.user_email, gymId });
  const reverseOnly = process.argv.includes("--reverse-only");
  const carmen = DEMO_VOLUNTARY_CASES[0];
  const carmenMembership = await prisma.membresiaCliente.findFirst({ where: { membresia_id: voluntaryMembershipId(carmen.key), gym_id: gymId } });
  if (!reverseOnly && carmenMembership?.estado !== "CANCELADA") throw new Error("La cancelación local de Carmen todavía no llegó al remoto.");

  const pablo = DEMO_VOLUNTARY_CASES[1];
  const membershipId = voluntaryMembershipId(pablo.key);
  const response = await app.request(
    `http://gymos.test/clientes/${pablo.ci}/membresias/${membershipId}/cancelacion-voluntaria${reverseOnly ? "/revertir" : ""}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(reverseOnly
        ? { operation_id: randomUUID(), motivo: "Prueba de reverso sincronizable remoto" }
        : { operation_id: randomUUID(), tipo_resolucion: "REEMBOLSO_PENDIENTE", motivo: "Cambio de residencia del socio" }),
    },
  );
  const body = await response.json() as any;
  const expectedStatus = reverseOnly ? 200 : 201;
  if (response.status !== expectedStatus) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  if (reverseOnly) {
    if (body.estado_membresia !== "PAUSADA" || body.cancelacion?.revertida !== true) {
      throw new Error(`Reverso inesperado: ${JSON.stringify(body)}`);
    }
    console.log("ORIGEN  SOCIO   MEMBRESÍA  REVERSO  DESTINO_SYNC");
    console.log(`REMOTO  ${pablo.name.padEnd(7)} PAUSADA     CREADO   LOCAL`);
  } else {
    if (body.estado_membresia !== "CANCELADA" || body.cancelacion?.estado !== "PENDIENTE_TESORERIA" || body.cancelacion?.importe_reembolso !== pablo.expectedUnused) {
      throw new Error(`Reembolso inesperado: ${JSON.stringify(body)}`);
    }
    console.log("ORIGEN  SOCIO   MEMBRESÍA  RESOLUCIÓN          IMPORTE  CAJA_MOVIMIENTO");
    console.log(`REMOTO  ${pablo.name.padEnd(7)} CANCELADA   REEMBOLSO_PENDIENTE ${Number(body.cancelacion.importe_reembolso).toFixed(2).padEnd(8)} NO`);
  }
} finally {
  await prisma.$disconnect();
}
