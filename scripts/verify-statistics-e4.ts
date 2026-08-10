import { trustedClock } from "../src/config/trusted-clock";
import { datePartsInZone } from "../src/config/tz";
import { prisma } from "../src/infrastructure/db/prismaClient";
import { TreasuryLedgerService } from "../src/application/accounting/treasury-ledger.service";
import { ManagementMarginService } from "../src/application/reporting/management-margin.service";
import { GovernedExpenseService } from "../src/application/reporting/governed-expense.service";
import { AccrualOperatingResultService } from "../src/application/reporting/accrual-operating-result.service";
import { ExchangeRevaluationService } from "../src/application/reporting/exchange-revaluation.service";
import { EstadisticasContabilidadService } from "../src/application/reporting/estadisticas-contabilidad.service";
import { PrismaEstadisticasContabilidadReader } from "../src/infrastructure/repositories/prisma-estadisticas-contabilidad.reader";
import { PrismaMembershipRevenueReader } from "../src/infrastructure/reporting/prisma-membership-revenue.reader";
import { PrismaTrainerServiceCostReader } from "../src/infrastructure/reporting/prisma-trainer-service-cost.reader";
import { PrismaManagementMarginMonthlyCloseReader } from "../src/infrastructure/reporting/prisma-management-margin.reader";
import { PrismaGovernedExpenseReader } from "../src/infrastructure/reporting/prisma-governed-expense.reader";
import { PrismaExchangeRevaluationReader } from "../src/infrastructure/reporting/prisma-exchange-revaluation.reader";
import { imprimirVerificacionE4 } from "../../scripts/verify-statistics-e4-report";

const gymId = process.env.DEMO_GYM_ID ?? "local-gym-001";
try {
  const gym = await prisma.gym.findUnique({ where: { gym_id: gymId }, select: { timezone: true } });
  const zona = gym?.timezone?.trim() || "America/Los_Angeles";
  const parts = datePartsInZone(zona, trustedClock.nowUtc());
  const hoy = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const treasury = new TreasuryLedgerService();
  const margin = new ManagementMarginService(
    new PrismaMembershipRevenueReader(), new PrismaTrainerServiceCostReader(),
    new PrismaManagementMarginMonthlyCloseReader(),
  );
  const expenses = new GovernedExpenseService(new PrismaGovernedExpenseReader());
  const service = new EstadisticasContabilidadService(
    new PrismaEstadisticasContabilidadReader(),
    { get: ({ gymId, month }) => treasury.monthly(gymId, month) },
    new AccrualOperatingResultService(margin, expenses, new PrismaManagementMarginMonthlyCloseReader()),
    new ExchangeRevaluationService(new PrismaExchangeRevaluationReader()),
  );
  await imprimirVerificacionE4({
    motor: "MariaDB (gym-remote-api)",
    dashboard: () => service.dashboard({ gymId, zona, hoy, desde: "2026-05", hasta: "2026-07" }),
  });
} finally {
  await prisma.$disconnect();
}
