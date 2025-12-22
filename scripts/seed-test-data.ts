import { PrismaClient } from "@prisma/client";
import { PrismaUserRepository } from "../src/infrastructure/repositories/PrismaUserRepository";
import { v4 as uuidv4 } from "uuid";

const prisma = new PrismaClient();
const userRepository = new PrismaUserRepository();

async function main() {
    console.log("Seeding test data...");

    // 1. Create Gym
    const gymId = "gym_test_1";
    await prisma.gym.upsert({
        where: { gym_id: gymId },
        update: {},
        create: {
            gym_id: gymId,
            codigo: "GYM001",
            nombre: "Test Gym",
            activo: true
        }
    });
    console.log("Gym created.");

    // 2. Create Device
    const deviceId = "device_test_1";
    await prisma.device.upsert({
        where: { device_id: deviceId },
        update: { secret_key: "secret_test_1" },
        create: {
            device_id: deviceId,
            gym_id: gymId,
            nombre: "Test Device",
            tipo: "BACKEND_OFFLINE",
            secret_key: "secret_test_1",
            is_active: true
        }
    });
    console.log("Device created.");

    // 3. Create User using Repository (to trigger SyncLog)
    const userId = "user_test_sync";
    const email = "sync_test@example.com";

    // Clean up if exists
    try {
        await prisma.user.delete({ where: { user_email: email } });
    } catch { }

    await userRepository.create({
        user_id: userId,
        user_nombre: "Sync Test User",
        user_email: email,
        password: "password123", // In real app should be hashed
        role: "user",
        gym_id: gymId,
        createdAt: new Date(),
        version: 1
    });
    console.log("User created via Repository (should have SyncLog).");

    // Verify SyncLog
    const log = await prisma.syncLog.findFirst({
        where: { entidad_id: userId, entidad: 'user' }
    });

    if (log) {
        console.log("SUCCESS: SyncLog entry found for user.");
    } else {
        console.error("FAILURE: No SyncLog entry found for user!");
        process.exit(1);
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
