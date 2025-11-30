
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkSyncLogs() {
    console.log("🔍 Checking SyncLog entries...");
    try {
        const logs = await prisma.syncLog.findMany({
            orderBy: { created_at: 'desc' },
            take: 10
        });

        console.log(`Found ${logs.length} SyncLog entries.`);
        logs.forEach(log => {
            console.log(`- [${log.created_at.toISOString()}] ${log.operacion} ${log.entidad} (ID: ${log.entidad_id}) Gym: ${log.gym_id}`);
        });

    } catch (error) {
        console.error("❌ Error checking SyncLogs:", error);
    } finally {
        await prisma.$disconnect();
    }
}

checkSyncLogs();
