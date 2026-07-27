import { prisma } from "../db/prismaClient";
import { type SyncTransactionContext } from "../../application/use-cases/sync/sync-transaction";
import type { Gym } from "../../domain/entities/Gym";
import { trustedClock } from "../../config/trusted-clock";

export class PrismaGymRepository {
  // Unidad 01: `client` es prisma o el cliente de la transacción del upload.
  constructor(private readonly client: any = prisma) {}

  withTransaction(tx: SyncTransactionContext): PrismaGymRepository {
    return new PrismaGymRepository(tx);
  }

    async upsertGym(gym: Gym): Promise<void> {
        await this.client.gym.upsert({
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
                created_at: gym.created_at ?? trustedClock.nowUtc(),
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
        await this.client.gym.update({
            where: { gym_id: id },
            data: {
                deleted_at: trustedClock.nowUtc(),
                activo: false
            }
        });
    }
}
