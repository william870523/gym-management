import { randomUUID } from "crypto";
import type { UpdateEntrenadorDTO } from "../../dtos/EntrenadorDTO";
import type { Entrenador } from "../../../domain/entities/Entrenador";
import type { EntrenadorRepository } from "../../../domain/repositories/EntrenadorRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class UpdateEntrenadorUseCase {
    constructor(
        private readonly entrenadorRepository: EntrenadorRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, dto: UpdateEntrenadorDTO, gymId: string): Promise<void> {
        const existing = await this.entrenadorRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("Entrenador not found");
        }

        const updateData: Partial<Entrenador> = {
            ...dto,
            foto_entrenador: dto.foto_entrenador ? Buffer.from(dto.foto_entrenador, 'base64') : undefined,
            fecha_incio_entrenador: dto.fecha_incio_entrenador ? new Date(dto.fecha_incio_entrenador) : undefined,
            updated_at: trustedClock.nowUtc(),
            version: (existing.version ?? 0) + 1
        };

        await this.entrenadorRepository.update(id, gymId, updateData);

        const updated = await this.entrenadorRepository.findById(id, gymId);
        if (updated) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "entrenador",
                operacion: "UPDATE",
                entidadId: id,
                gymId: updated.gym_id ?? null,
                deviceId: "WEB_ADMIN",
                payload: {
                    ...updated,
                    foto_entrenador: updated.foto_entrenador ? Buffer.from(updated.foto_entrenador).toString('base64') : null
                } as any
            });
        }
    }
}

