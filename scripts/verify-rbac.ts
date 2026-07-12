import { PrismaClient } from "@prisma/client";
import { JwtService } from "../src/infrastructure/auth/jwt.service";
import { env } from "../src/config/env";

const prisma = new PrismaClient();
const BASE_URL = `http://localhost:${env.port}`;

async function verifyRBAC() {
    console.log(`Verifying RBAC on ${BASE_URL}...`);

    // 1. Get Admin Token
    const adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (!adminUser) throw new Error("No admin user found");

    const adminToken = JwtService.signAdminToken({
        userId: adminUser.user_id,
        email: adminUser.user_email,
        role: adminUser.role
    });

    // 2. Create Receptionist User
    let recepUser = await prisma.user.findUnique({ where: { user_email: 'recep@test.com' } });
    if (!recepUser) {
        recepUser = await prisma.user.create({
            data: {
                user_id: 'recep-test-id',
                user_nombre: 'Receptionist Test',
                user_email: 'recep@test.com',
                password: 'hash',
                role: 'user',
                active: true,
                version: 1
            }
        });
    }

    const recepRole = await prisma.role.findUnique({ where: { name: 'RECEPTIONIST' } });
    if (!recepRole) throw new Error("RECEPTIONIST role not found");

    // Clear and Connect Role to ensure consistent state
    await prisma.user.update({
        where: { user_id: recepUser.user_id },
        data: {
            roles: {
                set: [],
                connect: { id: recepRole.id }
            }
        }
    });

    const recepToken = JwtService.signAdminToken({
        userId: recepUser.user_id,
        email: recepUser.user_email,
        role: 'user'
    });

    // 3. Test Cases for USERS endpoint (Admin vs Receptionist)

    // 3.1 Admin GET /users (Should Succeed)
    const resAdmin = await fetch(`${BASE_URL}/users`, {
        headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log(`Admin GET /users: ${resAdmin.status} ${resAdmin.statusText} (Expected 200)`);

    // 3.2 Receptionist GET /users (Should Forbidden)
    const resRecep = await fetch(`${BASE_URL}/users`, {
        headers: { Authorization: `Bearer ${recepToken}` }
    });
    console.log(`Recep GET /users: ${resRecep.status} ${resRecep.statusText} (Expected 403)`);

    if (resAdmin.status === 200 && resRecep.status === 403) {
        console.log("SUCCESS: RBAC enforced correctly.");
    } else {
        console.error("FAILURE: RBAC check failed.");
        process.exit(1);
    }
}

verifyRBAC()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
