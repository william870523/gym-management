import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  M3_GYMS,
  M3_IDS,
  installDemoCatalogScopeM3,
  removeDemoCatalogScopeM3,
} from "../../scripts/demo-catalog-scope-m3";
import { quoteMethodSurcharge } from "../src/application/payment/method-surcharge.service";

const before = await prisma.syncLog.count();
try {
  if (process.argv.includes("--remove")) await removeDemoCatalogScopeM3(prisma);
  else if (process.argv.includes("--verify")) {
    const [eur, cup] = await Promise.all([
      prisma.moneda.findFirstOrThrow({ where: { codigo: "EUR", is_deleted: false } }),
      prisma.moneda.findFirstOrThrow({ where: { codigo: "CUP", is_deleted: false } }),
    ]);
    const quotes = await Promise.all([
      [M3_GYMS.norte, M3_IDS.accountNorte],
      [M3_GYMS.oeste, M3_IDS.accountOeste],
    ].map(async ([gymId, accountId]) => ({
      database: "MariaDB",
      gym_id: gymId,
      quote: await quoteMethodSurcharge(prisma, {
        baseAmount: "10.00",
        paymentTypeId: M3_IDS.paymentType,
        accountId,
        paymentCurrencyId: eur.moneda_id,
        planCurrencyId: cup.moneda_id,
        exchangeRateId: M3_IDS.rate,
      }, gymId, new Date("2026-08-15T12:00:00.000Z")),
    })));
    console.log(JSON.stringify(quotes, null, 2));
  } else await installDemoCatalogScopeM3(prisma);
  const after = await prisma.syncLog.count();
  if (after !== before) throw new Error(`La fixture M3 alteró sync_log: ${before} → ${after}.`);
  const action = process.argv.includes("--remove")
    ? "retirada"
    : process.argv.includes("--verify") ? "verificada" : "instalada";
  console.log(`Fixture M3 remota ${action}; sync_log sin cambios (${after}).`);
} finally { await prisma.$disconnect(); }
