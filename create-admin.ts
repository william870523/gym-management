// Script to create admin user in REMOTE database
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function createRemoteAdmin() {
    console.log("🔐 Creating admin user in REMOTE database...");

    const userEmail = "admin@gym.test";
    const password = "admin123";
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        const existing = await prisma.user.findUnique({
            where: { user_email: userEmail },
        });

        if (existing) {
            console.log("ℹ️  Admin user already exists");
            console.log(`Email: ${userEmail}`);
            console.log(`Password: ${password}`);
        } else {
            await prisma.user.create({
                data: {
                    user_id: crypto.randomUUID(),
                    user_nombre: "Admin",
                    user_email: userEmail,
                    password: hashedPassword,
                    role: "admin",
                    created_at: new Date(),
                },
            });
            console.log("✅ Admin user created successfully!");
            console.log(`Email: ${userEmail}`);
            console.log(`Password: ${password}`);
        }
    } catch (error: any) {
        console.error("❌ Failed to create admin:", error.message);
    } finally {
        await prisma.$disconnect();
    }
}

createRemoteAdmin();
