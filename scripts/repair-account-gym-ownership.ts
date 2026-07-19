/**
 * Completa la propiedad de cuentas heredadas usando el dispositivo que las
 * originó. Es idempotente y nunca asigna una cuenta si el dispositivo no
 * existe o no tiene un gimnasio inequívoco.
 */
import { prisma } from "../src/infrastructure/db/prismaClient";
import { trustedClock } from "../src/config/trusted-clock";

const candidates = await prisma.cuenta.findMany({
  where: {
    gym_id: null,
    source_device: { not: null },
    is_deleted: false,
  },
  select: {
    cuenta_id: true,
    nombre_cuenta: true,
    source_device: true,
  },
});
const now = trustedClock.nowUtc();

const deviceIds = [
  ...new Set(
    candidates
      .map((row) => row.source_device)
      .filter((value): value is string => Boolean(value)),
  ),
];
const devices = deviceIds.length
  ? await prisma.device.findMany({
      where: { device_id: { in: deviceIds } },
      select: { device_id: true, gym_id: true },
    })
  : [];
const gymByDevice = new Map(devices.map((row) => [row.device_id, row.gym_id]));

let repaired = 0;
const unresolved: Array<{ account: string; sourceDevice: string | null }> = [];
await prisma.$transaction(async (tx) => {
  for (const account of candidates) {
    const gymId = account.source_device
      ? gymByDevice.get(account.source_device)
      : null;
    if (!gymId) {
      unresolved.push({
        account: account.nombre_cuenta,
        sourceDevice: account.source_device,
      });
      continue;
    }
    const result = await tx.cuenta.updateMany({
      where: { cuenta_id: account.cuenta_id, gym_id: null },
      data: {
        gym_id: gymId,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    repaired += result.count;
  }
});

console.log(JSON.stringify({
  candidates: candidates.length,
  repaired,
  unresolved,
}));
await prisma.$disconnect();
