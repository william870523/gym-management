
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    console.log('Truncating Catalogs and Dependents REMOTELY...');
    try {
        // Delete dependents first
        await prisma.detallePago.deleteMany({});
        await prisma.pagoCliente.deleteMany({});
        await prisma.cuenta.deleteMany({});
        await prisma.planesPago.deleteMany({});
        await prisma.tipoCambio.deleteMany({});

        // Delete Catalogs
        await prisma.moneda.deleteMany({});
        // Check if Nacionalidad table exists in remote schema logic. 
        // Based on local schema mirroring remote, it should be 'nacionalidades'.
        // We use the Prisma model name 'Nacionalidad'.
        try {
            await prisma.nacionalidad.deleteMany({});
        } catch (e) {
            console.warn("Could not delete Nacionalidad (perhaps table missing in remote prisma client yet?):", e);
        }

        // Clear SyncLog/SyncState for these? 
        // Remote uses SyncLog for changes. We should probably clear it to avoid "echo" but SyncWorker handles echoes.
        // Clearing it is safer for a "hard reset".
        await prisma.syncLog.deleteMany({
            where: { entidad: { in: ['monedas', 'nacionalidades', 'moneda', 'nacionalidad'] } } // handling both plural/singular just in case
        });

        console.log('Remote Truncation complete.');
    } catch (e) {
        console.error('Error truncating remote:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
