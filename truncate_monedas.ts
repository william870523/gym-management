import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Truncating Moneda table...');
    try {
        // Delete dependent tables first to avoid FK violations
        await prisma.detallePago.deleteMany({});
        await prisma.pagoCliente.deleteMany({});
        await prisma.cuenta.deleteMany({});
        await prisma.planesPago.deleteMany({});
        await prisma.tipoCambio.deleteMany({});

        // Now delete Monedas
        await prisma.moneda.deleteMany({}); console.log('Successfully truncated Moneda table.');
    } catch (error) {
        console.error('Error truncating Moneda table:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
