
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TARGET_USER_ID = "edafa871-91aa-43d9-a16b-e2d913b521ad";

async function main() {
    console.log("--- REMOTE DB INSPECTION ---");
    const user = await prisma.user.findUnique({
        where: { user_id: TARGET_USER_ID }
    });
    console.log("User Record:", JSON.stringify(user, null, 2));

    const logs = await prisma.syncLog.findMany({
        where: {
            entidad: "user",
            entidad_id: TARGET_USER_ID
        },
        orderBy: { created_at: "desc" },
        take: 5
    });
    console.log("Recent Sync Logs:", JSON.stringify(logs, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
