
import { PrismaClient } from "@prisma/client";

console.log("🚀 Starting debug_db.ts");
console.log("📂 CWD:", process.cwd());
console.log("🔗 DATABASE_URL:", process.env.DATABASE_URL);

const prisma = new PrismaClient();

async function main() {
    try {
        console.log("CONNECTING...");
        await prisma.$connect();
        console.log("CONNECTED.");

        const count = await prisma.device.count();
        console.log("📊 Device Count:", count);

        const all = await prisma.device.findMany();
        console.log("📋 Devices:", JSON.stringify(all, null, 2));

        const target = await prisma.device.findUnique({ where: { device_id: "device-001" } });
        if (target) {
            console.log("✅ FOUND device-001!");
            console.log("Secret match:", target.secret_key === "mock-device-token");
        } else {
            console.error("❌ device-001 NOT FOUND.");
        }

    } catch (e) {
        console.error("💥 ERROR:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
