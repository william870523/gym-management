import { PrismaClient } from "@prisma/client";
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

const predefinedPermissions = [
    // Users
    { action: 'users.read', description: 'View users' },
    { action: 'users.write', description: 'Create/Update users' },
    { action: 'users.delete', description: 'Delete users' },
    // Clients
    { action: 'clients.read', description: 'View clients' },
    { action: 'clients.write', description: 'Create/Update clients' },
    { action: 'clients.delete', description: 'Delete clients' },
    // Trainers
    { action: 'trainers.read', description: 'View trainers' },
    { action: 'trainers.write', description: 'Manage trainers' },
    // Payments
    { action: 'payments.read', description: 'View payments' },
    { action: 'payments.write', description: 'Process payments' },
    // Plans
    { action: 'plans.read', description: 'View plans' },
    { action: 'plans.write', description: 'Manage plans' },
    // Settings/Admin
    { action: 'settings.manage', description: 'Manage system settings' },
    // Roles
    { action: 'roles.read', description: 'View roles' },
    { action: 'roles.write', description: 'Manage roles' },
];

const roles = [
    {
        name: 'ADMIN',
        description: 'Administrator with full access',
        permissions: ['*'] // all
    },
    {
        name: 'RECEPTIONIST',
        description: 'Front desk staff',
        permissions: [
            'clients.read', 'clients.write',
            'payments.read', 'payments.write',
            'plans.read',
            'trainers.read'
        ]
    }
];

async function main() {
    console.log("Seeding RBAC...");

    // 1. Create Permissions
    const permissionMap = new Map<string, string>(); // action -> id

    for (const p of predefinedPermissions) {
        const existing = await prisma.permission.findUnique({ where: { action: p.action } });
        if (!existing) {
            const created = await prisma.permission.create({
                data: {
                    action: p.action,
                    description: p.description,
                    version: 1,
                    is_deleted: false
                }
            });
            permissionMap.set(p.action, created.id);
            console.log(`Created permission: ${p.action}`);
        } else {
            permissionMap.set(p.action, existing.id);
            console.log(`Permission exists: ${p.action}`);
        }
    }

    // 2. Create Roles
    for (const r of roles) {
        let role = await prisma.role.findUnique({ where: { name: r.name } });
        if (!role) {
            role = await prisma.role.create({
                data: {
                    name: r.name,
                    description: r.description,
                    version: 1,
                    is_deleted: false
                }
            });
            console.log(`Created role: ${r.name}`);
        } else {
            console.log(`Role exists: ${r.name}`);
        }

        // 3. Assign Permissions
        let permsToConnect: string[] = [];

        if (r.permissions.includes('*')) {
            permsToConnect = Array.from(permissionMap.values());
        } else {
            permsToConnect = r.permissions.map(action => permissionMap.get(action)).filter(id => id !== undefined) as string[];
        }

        // Update role permissions
        // For simplicity, we just connect all. Ideally clean up old ones if strict sync needed.
        await prisma.role.update({
            where: { id: role.id },
            data: {
                permissions: {
                    connect: permsToConnect.map(id => ({ id }))
                }
            }
        });
        console.log(`Assigned ${permsToConnect.length} permissions to ${r.name}`);
    }

    // 4. Migrate existing Admin users
    const admins = await prisma.user.findMany({ where: { role: 'admin' } });
    const adminRole = await prisma.role.findUnique({ where: { name: 'ADMIN' } });

    if (adminRole) {
        for (const user of admins) {
            // Check if already has role
            const count = await prisma.user.count({
                where: {
                    user_id: user.user_id,
                    roles: { some: { id: adminRole.id } }
                }
            });

            if (count === 0) {
                await prisma.user.update({
                    where: { user_id: user.user_id },
                    data: {
                        roles: {
                            connect: { id: adminRole.id }
                        }
                    }
                });
                console.log(`Migrated user ${user.user_email} to ADMIN role`);
            }
        }
    }

    console.log("RBAC Seeding Complete.");
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
