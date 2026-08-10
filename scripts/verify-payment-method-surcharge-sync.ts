/** R5.1: prueba aislada local→remoto del handler dedicado de upload. */
import { randomUUID } from "crypto";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { ApplyDetallePagoEventUseCase } from "../src/application/use-cases/sync/ApplyDetallePagoEventUseCase";
import { PrismaDetallePagoRepository } from "../src/infrastructure/repositories/PrismaDetallePagoRepository";
import { R51_PROOF_CLIENT_CI, R51_GYM_ID, R51_IDS } from "../../scripts/demo-payment-method-surcharge";

const tempId = randomUUID();
try {
  const payment = await prisma.pagoCliente.findFirstOrThrow({
    where: { gym_id: R51_GYM_ID, ci: R51_PROOF_CLIENT_CI, id_planes_pago: R51_IDS.plan },
    orderBy: { fecha: "desc" },
  });
  const source = await prisma.detallePago.findFirstOrThrow({
    where: { pago_cliente_id: payment.pago_cliente_id },
  });
  const logBefore = await prisma.syncLog.count();
  await new ApplyDetallePagoEventUseCase(new PrismaDetallePagoRepository()).execute({
    eventId: randomUUID(), entidadId: tempId, operacion: "INSERT",
    gymId: R51_GYM_ID, deviceId: "LOCAL_R51_PROOF",
    payload: { ...source, detalle_pago_id: tempId } as any,
  });
  const stored = await prisma.detallePago.findUniqueOrThrow({
    where: { detalle_pago_id: tempId },
  });
  const logAfter = await prisma.syncLog.count();
  console.log(JSON.stringify({ direccion: "local→remoto", aplicador: "handler dedicado upload",
    base: stored.recargo_metodo_base, pct: stored.recargo_metodo_pct,
    recargo: stored.recargo_metodo_importe, total: stored.recargo_metodo_total,
    politica: stored.recargo_metodo_politica,
    cola_sin_contaminar: logBefore === logAfter }, null, 2));
} finally {
  await prisma.detallePago.deleteMany({ where: { detalle_pago_id: tempId } });
  await prisma.$disconnect();
}
