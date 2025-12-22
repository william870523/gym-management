
import { PrismaClient } from "@prisma/client";

console.log("DB URL (partial):", process.env.DATABASE_URL?.substring(0, 15) + "...");

const prisma = new PrismaClient();

async function checkDevice() {
    console.log("🔍 Checking for device-001...");
    try {
        const device = await prisma.device.findUnique({
            where: { device_id: "device-001" }
        });

        if (device) {
            console.log("✅ Device found:", device);
        } else {
            console.error("❌ Device NOT found.");
            // List all to be sure
            const all = await prisma.device.findMany();
            console.log("Count:", all.length);
            if (all.length > 0) console.log("First:", all[0]);
        }
    } catch (e) {
        console.error("Error:", e);
    }
    await prisma.$disconnect();
}

checkDevice();
