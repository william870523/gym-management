import { PrismaClient } from "@prisma/client";
import { kWorldCurrencies } from "./shared_currencies";
// Remote uses 'crypto' possibly from Node, assuming environment structure. 
// If Bun, global crypto exists.

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding REMOTE currencies and creating SyncLog events...');

    for (const currency of kWorldCurrencies) {
        try {
            await prisma.$transaction(async (tx) => {
                const monedaId = currency.id;

                const data = {
                    moneda_nombre: currency.name,
                    codigo: currency.code,
                    simbolo: currency.symbol,
                    is_deleted: false,
                    version: { increment: 1 },
                    updated_at: new Date(),
                    // Remote schema: deleted_at is nullable
                };

                let op = "UPDATE";
                let result;

                // We'll upsert using deterministic ID
                const upsertData = {
                    moneda_id: monedaId,
                    moneda_nombre: currency.name,
                    codigo: currency.code,
                    simbolo: currency.symbol,
                    is_deleted: false,
                    version: 1,
                    created_at: new Date(),
                    updated_at: new Date(),
                };

                result = await tx.moneda.upsert({
                    where: { moneda_id: monedaId },
                    create: upsertData,
                    update: data
                });

                if (result.created_at?.getTime() === result.updated_at.getTime()) {
                    op = "INSERT";
                }

                // Create SyncLog Entry
                const payload = { ...result };
                // @ts-ignore
                if (payload.imagen && Buffer.isBuffer(payload.imagen)) {
                    // @ts-ignore
                    payload.imagen = payload.imagen.toString('base64');
                }

                await tx.syncLog.create({
                    data: {
                        event_id: crypto.randomUUID(),
                        entidad: "monedas",
                        operacion: op,
                        entidad_id: monedaId,
                        payload_json: JSON.stringify(payload),
                        gym_id: null,
                        device_id: null
                    }
                });

                console.log(`REMOTE ${op}: ${currency.name} (${currency.code}) [${monedaId}]`);
            });

        } catch (error) {
            console.error(`Failed to process ${currency.code}:`, error);
        }
    }

    console.log('Remote Seeding complete.');
}

main()
    .catch((e) => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
