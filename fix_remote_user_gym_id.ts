
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TARGET_USER_ID = "edafa871-91aa-43d9-a16b-e2d913b521ad";
const CORRECT_GYM_ID = "local-gym-001";

async function main() {
    console.log(`Updating User ${TARGET_USER_ID} to Gym ID: ${CORRECT_GYM_ID}...`);

    const updated = await prisma.user.update({
        where: { user_id: TARGET_USER_ID },
        data: { gym_id: CORRECT_GYM_ID }
    });

    // Manually create SyncLog to ensure it's picked up (Trigger usually does this, but being safe)
    // Actually, the controller logic does the logging usually. 
    // Since I am bypassing controller, I MUST create the log manually.

    await prisma.syncLog.create({
        data: {
            event_id: crypto.randomUUID(),
            entidad: "user",
            operacion: "UPDATE",
            entidad_id: updated.user_id,
            gym_id: updated.gym_id, // Now correct
            device_id: null,
            payload_json: JSON.stringify(updated),
        },
    });

    console.log("Update and SyncLog created successfully.");
    console.log("New User Record:", JSON.stringify(updated, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
