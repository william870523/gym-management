import { prisma } from "../db/prismaClient";

/**
 * Loads all permissions for a user from their assigned roles.
 * Includes derived permissions (e.g. from role inheritance if we had it, but mostly direct role-perm mapping).
 */
export async function hydratePermissions(userId: string): Promise<Set<string>> {
    const user = await prisma.user.findUnique({
        where: { user_id: userId },
        include: {
            roles: {
                include: {
                    permissions: true
                }
            }
        }
    });

    const perms = new Set<string>();
    if (user?.roles) {
        for (const role of user.roles) {
            for (const p of role.permissions) {
                perms.add(p.action);
            }
        }
    }
    return perms;
}
