
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log("🗑️ Truncating Remote Reference Data...");

    // Delete all records (cascade might handle relations, but safer to delete)
    await prisma.moneda.deleteMany({});
    console.log("   ✅ Monedas deleted.");

    await prisma.nacionalidad.deleteMany({});
    console.log("   ✅ Nacionalidades deleted.");
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
