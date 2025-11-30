
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function setupInitialData() {
    console.log("🌱 Seeding Initial Data in Remote Database...");

    try {
        // 1. Create Admin User
        const userEmail = "admin@gym.test";
        const password = "admin123";
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.user.create({
            data: {
                user_id: "test-admin-user",
                user_nombre: "Admin User",
                user_email: userEmail,
                password: hashedPassword,
                role: "admin",
                createdAt: new Date(),
            },
        });
        console.log("✅ Admin User created");

        // 2. Create Gym
        const gymId = "test-gym-01";
        await prisma.gym.create({
            data: {
                gym_id: gymId,
                codigo: "GYM001",
                nombre: "Test Gym Central",
                direccion: "123 Test St",
                ciudad: "Test City",
                pais: "Testland",
                activo: true,
            },
        });
        console.log("✅ Gym created");

        // 3. Create Device
        const deviceId = "test-device-01";
        await prisma.device.create({
            data: {
                device_id: deviceId,
                gym_id: gymId,
                nombre: "Test Device 01",
                tipo: "BACKEND_OFFLINE",
                secret_key: "device-secret",
                is_active: true,
            },
        });
        console.log("✅ Device created");

        // 4. Create SyncLog entries
        await prisma.syncLog.createMany({
            data: [
                {
                    event_id: crypto.randomUUID(),
                    entidad: "gym",
                    operacion: "INSERT",
                    entidad_id: "test-gym-01",
                    gym_id: "test-gym-01",
                    payload_json: JSON.stringify({
                        gym_id: "test-gym-01",
                        codigo: "GYM001",
                        nombre: "Test Gym 01",
                        direccion: "Test Address",
                        activo: true
                    }),
                },
                {
                    event_id: crypto.randomUUID(),
                    entidad: "device",
                    operacion: "INSERT",
                    entidad_id: "test-device-01",
                    gym_id: "test-gym-01",
                    payload_json: JSON.stringify({
                        device_id: "test-device-01",
                        gym_id: "test-gym-01",
                        nombre: "Test Device 01",
                        tipo: "BACKEND_OFFLINE",
                        activo: true
                    }),
                },
                {
                    event_id: crypto.randomUUID(),
                    entidad: "user",
                    operacion: "INSERT",
                    entidad_id: "test-admin-user",
                    gym_id: null,
                    payload_json: JSON.stringify({
                        user_id: "test-admin-user",
                        user_nombre: "Admin User",
                        user_email: "admin@gym.test",
                        password: hashedPassword,
                        role: "admin",
                        gym_id: null,
                        is_deleted: false
                    }),
                }
            ]
        });

        console.log("✅ SyncLog entries created");

    } catch (error: any) {
        console.error("❌ Failed to seed initial data:", error.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

setupInitialData();
