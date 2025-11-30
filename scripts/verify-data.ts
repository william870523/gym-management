
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function verifyData() {
    console.log("🔍 Verifying Remote Data...");
    try {
        const device = await prisma.device.findUnique({
            where: { device_id: "test-device-01" }
        });

        if (!device) {
            console.error("❌ Device 'test-device-01' NOT FOUND!");
        } else {
            console.log("✅ Device found:", device);
            console.log("   Secret:", device.secret_key);
            console.log("   Active:", device.is_active);
        }

        const user = await prisma.user.findFirst({
            where: { user_email: "admin@gym.test" }
        });
        if (!user) {
            console.error("❌ User 'admin@gym.test' NOT FOUND!");
        } else {
            console.log("✅ User found:", user);
        }

    } catch (error) {
        console.error("Error verifying data:", error);
    } finally {
        await prisma.$disconnect();
    }
}

verifyData();
