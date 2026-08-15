import { verifyMoneyDecimal } from "../../scripts/demo-money-decimal";
import { prisma } from "../src/infrastructure/db/prismaClient";

try {
  await verifyMoneyDecimal(prisma, "mariadb");
} finally {
  await prisma.$disconnect();
}

