import { prisma } from "../db/prismaClient";
import type { Gym } from "../../domain/entities/Gym";
import { trustedClock } from "../../config/trusted-clock";

export class PrismaGymRepository {
    async upsertGym(gym: Gym): Promise<void> {
        await prisma.gym.upsert({
            where: { gym_id: gym.gym_id },
            create: {
                gym_id: gym.gym_id,
                codigo: gym.codigo,
                nombre: gym.nombre,
                direccion: gym.direccion,
                ciudad: gym.ciudad,
                provincia: gym.provincia,
                pais: gym.pais,
                codigo_postal: gym.codigo_postal,
                timezone: gym.timezone,
                activo: gym.activo,
                created_at: gym.created_at,
                updated_at: gym.updated_at,
                deleted_at: gym.deleted_at
            },
            update: {
                codigo: gym.codigo,
                nombre: gym.nombre,
                direccion: gym.direccion,
                ciudad: gym.ciudad,
                provincia: gym.provincia,
                pais: gym.pais,
                codigo_postal: gym.codigo_postal,
                timezone: gym.timezone,
                activo: gym.activo,
                updated_at: trustedClock.nowUtc(),
                deleted_at: gym.deleted_at
            }
        });
    }

    async softDelete(id: string): Promise<void> {
        // Check if exists first to avoid error? Or update directly.
        // Prisma update throws if not found.
        try {
            await prisma.gym.update({
                where: { gym_id: id },
                data: {
                    // is_deleted: true, // Gym table doesnt have is_deleted usually?
                    // Let's check schema. SyncLog implies Gym has deleted_at but schema View said deleted_at DateTime?
                    // Schema check: deleted_at DateTime?
                    deleted_at: trustedClock.nowUtc(),
                    activo: false
                }
            });
        } catch (e) {
            // Ignore if not found
        }
    }
}
