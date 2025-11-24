import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:3001";

async function main() {
    console.log("--- Setting up Test Data ---");

    // Create Admin User
    const passwordHash = await bcrypt.hash("admin123", 10);
    const user = await prisma.user.upsert({
        where: { user_email: "admin@test.com" },
        update: { password: passwordHash, role: "admin" },
        create: {
            user_id: "admin-user-id",
            user_nombre: "Admin User",
            user_email: "admin@test.com",
            password: passwordHash,
            role: "admin",
            createdAt: new Date()
        }
    });
    console.log("Admin User ensured.");

    // Create Device
    const device = await prisma.device.upsert({
        where: { device_id: "test-device-id" },
        update: { secret_key: "secret123", is_active: true },
        create: {
            device_id: "test-device-id",
            nombre: "Test Device",
            secret_key: "secret123",
            is_active: true,
            gym: {
                connectOrCreate: {
                    where: { gym_id: "gym-1" },
                    create: {
                        gym_id: "gym-1",
                        codigo: "GYM1",
                        nombre: "Test Gym",
                        activo: true
                    }
                }
            }
        }
    });
    console.log("Device ensured.");

    console.log("\n--- Testing User Auth ---");

    // Login User
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@test.com", password: "admin123" })
    });

    if (!loginRes.ok) {
        console.error("User Login Failed:", await loginRes.text());
        process.exit(1);
    }

    const loginData = await loginRes.json();
    console.log("User Login Success:", loginData.ok);
    const userToken = loginData.token;

    // Access Protected Route (Admin)
    const adminRouteRes = await fetch(`${BASE_URL}/nacionalidades`, {
        headers: { "Authorization": `Bearer ${userToken}` }
    });
    console.log("Access Admin Route (with User Token):", adminRouteRes.status === 200 ? "OK" : `Failed ${adminRouteRes.status}`);

    // Access Protected Route (No Token)
    const noTokenRes = await fetch(`${BASE_URL}/nacionalidades`);
    console.log("Access Admin Route (No Token):", noTokenRes.status === 401 ? "BLOCKED (OK)" : `FAILED - Got ${noTokenRes.status}`);

    console.log("\n--- Testing Device Auth ---");

    // Login Device
    const deviceLoginRes = await fetch(`${BASE_URL}/auth/device-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: "test-device-id", secret: "secret123" })
    });

    if (!deviceLoginRes.ok) {
        console.error("Device Login Failed:", await deviceLoginRes.text());
        process.exit(1);
    }

    const deviceData = await deviceLoginRes.json();
    console.log("Device Login Success:", deviceData.ok);
    const deviceToken = deviceData.token;

    // Access Admin Route with Device Token -> Should be 403
    const deviceAccessAdminRes = await fetch(`${BASE_URL}/nacionalidades`, {
        headers: { "Authorization": `Bearer ${deviceToken}` }
    });
    console.log("Access Admin Route (with Device Token):", deviceAccessAdminRes.status === 403 ? "BLOCKED (OK)" : `FAILED - Got ${deviceAccessAdminRes.status}`);

    console.log("\n--- Verification Complete ---");
}

main().catch(console.error);
