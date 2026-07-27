/** Alias MariaDB del escenario canónico R4.6 (panel + informe). */
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_EXPENSE_GYM_ID,
  type DemoExpensePrisma,
} from "../../scripts/demo-expense-fixture-prisma";
import {
  resolveDemoFixtureOperation,
  runDemoGovernedExpenses,
  summarizeDemoGovernedExpenses,
} from "../../scripts/demo-governed-expenses";

try {
  const db = prisma as unknown as DemoExpensePrisma;
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(await summarizeDemoGovernedExpenses(db, DEMO_EXPENSE_GYM_ID)));
  } else {
    console.log(
      await runDemoGovernedExpenses(
        db,
        DEMO_EXPENSE_GYM_ID,
        resolveDemoFixtureOperation(process.argv),
      ),
    );
  }
} finally {
  await prisma.$disconnect();
}
