import { JwtService } from "../src/infrastructure/auth/jwt.service";
import { prisma } from "../src/infrastructure/db/prismaClient";

const BASE_URL = "http://localhost:3001";

async function main() {
    // 1. Generate Admin Token
    // We need a real user ID for the token payload usually, but let's grab the first admin.
    const adminUser = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (!adminUser) throw new Error("No admin user found");

    const token = JwtService.signAdminToken({
        userId: adminUser.user_id,
        role: adminUser.role
    });

    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    };

    console.log("Token generated.");

    // 2. GET /roles/permissions
    console.log("\n--- Testing GET /roles/permissions ---");
    const permsRes = await fetch(`${BASE_URL}/roles/permissions`, { headers });
    if (permsRes.status === 200) {
        const data = await permsRes.json();
        console.log(`Success! Found ${data.length} permissions.`);
    } else {
        console.error("Failed:", permsRes.status, await permsRes.text());
    }

    // 3. GET /roles
    console.log("\n--- Testing GET /roles ---");
    const rolesRes = await fetch(`${BASE_URL}/roles`, { headers });
    if (rolesRes.status === 200) {
        const data = await rolesRes.json();
        console.log(`Success! Found ${data.length} roles.`);
        console.log("Roles:", data.map((r: any) => r.name).join(", "));
    } else {
        console.error("Failed:", rolesRes.status, await rolesRes.text());
    }

    // 4. POST /roles
    console.log("\n--- Testing POST /roles ---");
    const newRole = {
        name: `Manager_${Date.now()}`,
        description: "Test Role",
        permissions: ["users.read", "payments.read"]
    };
    const createRes = await fetch(`${BASE_URL}/roles`, {
        method: "POST",
        headers,
        body: JSON.stringify(newRole)
    });

    let createdId = "";
    if (createRes.status === 201) {
        const data = await createRes.json();
        createdId = data.id;
        console.log(`Success! Created role ${data.name} with ID ${createdId}`);
    } else {
        console.error("Failed:", createRes.status, await createRes.text());
    }

    // 5. PUT /roles/:id
    if (createdId) {
        console.log("\n--- Testing PUT /roles/:id ---");
        const updateRes = await fetch(`${BASE_URL}/roles/${createdId}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({
                permissions: ["users.read", "payments.read", "roles.read"]
            })
        });
        if (updateRes.status === 200) {
            const data = await updateRes.json();
            console.log(`Success! Updated permissions: ${data.permissions.map((p: any) => p.action).join(", ")}`);
        } else {
            console.error("Failed:", updateRes.status, await updateRes.text());
        }
    }
}

main().catch(console.error);
