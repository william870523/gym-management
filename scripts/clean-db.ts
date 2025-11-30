
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanRemoteDb() {
    console.log('Cleaning Remote Database...');
    try {
        // Disable Foreign Key Checks
        await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0;');

        const tables = [
            'User', 'gym', 'device', 'monedas', 'nacionalidades', 'tipo_pago', 'tipo_cambio',
            'referencia', 'horario', 'planes_pago', 'cuenta', 'entrenadores', 'cliente_peso',
            'cliente', 'asistencia', 'pago_cliente', 'detalle_pago', 'sync_log',
            'sync_client_state', 'security_audit_log'
        ];

        for (const table of tables) {
            try {
                await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\`;`);
                console.log(`Truncated ${table}`);
            } catch (e) {
                console.log(`Failed to truncate ${table}, trying DELETE FROM: ${e.message}`);
                await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\`;`);
            }
        }

        // Re-enable Foreign Key Checks
        await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1;');

        const userCount = await prisma.user.count();
        console.log(`User count after cleaning: ${userCount}`);
        if (userCount > 0) {
            throw new Error("Failed to clean User table!");
        }

        console.log('Remote Database Cleaned Successfully.');
    } catch (error) {
        console.error('Error cleaning remote database:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

cleanRemoteDb();
