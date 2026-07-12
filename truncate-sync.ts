import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
    console.log('Truncating sync_log...')
    await prisma.$executeRawUnsafe('TRUNCATE TABLE sync_log')
    console.log('Done.')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
