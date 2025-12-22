import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('Truncating all tables in remote database...')

    // Disable foreign keys
    await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 0;`)

    const tablenames = await prisma.$queryRaw<Array<{ TABLE_NAME: string }>>`
    SELECT TABLE_NAME 
    FROM information_schema.tables 
    WHERE table_schema = DATABASE();
  `

    for (const { TABLE_NAME } of tablenames) {
        if (TABLE_NAME === '_prisma_migrations') continue;
        try {
            await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${TABLE_NAME}\`;`)
            console.log(`Truncated ${TABLE_NAME}`)
        } catch (error) {
            console.error(`Could not truncate ${TABLE_NAME}: ${error}`)
        }
    }

    // Re-enable foreign keys
    await prisma.$executeRawUnsafe(`SET FOREIGN_KEY_CHECKS = 1;`)
    console.log('Done.')
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
