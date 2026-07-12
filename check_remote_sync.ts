import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
    console.log("Checking remote tables...");

    const clientCount = await prisma.cliente.count();
    console.log(`Remote client count: ${clientCount}`);

    const syncLogCount = await prisma.syncLog.count();
    console.log(`Remote sync_log count: ${syncLogCount}`);

    const asistenciaCount = await prisma.asistencia.count();
    console.log(`Remote asistencia count: ${asistenciaCount}`);

    const recentSyncLogs = await prisma.syncLog.findMany({
        orderBy: { creado_en: 'desc' },
        take: 5,
        select: {
            id: true,
            event_id: true,
            entidad: true,
            operacion: true,
            entidad_id: true,
            creado_en: true
        }
    });
    console.log("Recent remote sync_logs:", recentSyncLogs);

    await prisma.$disconnect();
}

run().catch(console.error);
