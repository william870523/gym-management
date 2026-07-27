/** Wrapper MariaDB de la fixture canónica R4.7 (sin eventos de sync). */
import { prisma } from "../src/infrastructure/db/prismaClient";
import {
  DEMO_EXPENSE_GYM_ID,
  type DemoExpensePrisma,
} from "../../scripts/demo-expense-fixture-prisma";
import { resolveDemoFixtureOperation } from "../../scripts/demo-accrual-operating-result";
import {
  runDemoRecurringExpenses,
  summarizeDemoRecurringExpenses,
} from "../../scripts/demo-recurring-expenses";

try {
  const db = prisma as unknown as DemoExpensePrisma;
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(await summarizeDemoRecurringExpenses(db, DEMO_EXPENSE_GYM_ID)));
  } else {
    console.log(
      await runDemoRecurringExpenses(
        db,
        DEMO_EXPENSE_GYM_ID,
        resolveDemoFixtureOperation(process.argv),
      ),
    );
  }
} finally {
  await prisma.$disconnect();
}
