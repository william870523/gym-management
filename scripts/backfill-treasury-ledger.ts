import { TreasuryLedgerService } from "../src/application/accounting/treasury-ledger.service";
import { prisma } from "../src/infrastructure/db/prismaClient";

try {
  const gyms = await prisma.gym.findMany({
    where: { activo: true, deleted_at: null },
    select: { gym_id: true },
  });
  const service = new TreasuryLedgerService();
  const results = [];
  for (const gym of gyms) {
    results.push({
      gym_id: gym.gym_id,
      ...(await service.backfill(gym.gym_id)),
    });
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await prisma.$disconnect();
}
