import { randomUUID } from "crypto";
import type { UpdateHorarioDTO } from "../../dtos/HorarioDTO";
import type { Horario } from "../../../domain/entities/Horario";
import type { HorarioRepository } from "../../../domain/repositories/HorarioRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";
import { trustedClock } from "../../../config/trusted-clock";

export class UpdateHorarioUseCase {
    constructor(
        private readonly horarioRepository: HorarioRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, dto: UpdateHorarioDTO, gymId: string): Promise<void> {
        const existing = await this.horarioRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("Horario not found");
        }

        const updateData: Partial<Horario> = {
            ...dto,
            updated_at: trustedClock.nowUtc(),
            version: (existing.version ?? 0) + 1
        };

        await this.horarioRepository.update(id, gymId, updateData);

        const updated = await this.horarioRepository.findById(id, gymId);
        if (updated) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "horario",
                operacion: "UPDATE",
                entidadId: id,
                gymId,
                deviceId: "WEB_ADMIN",
                payload: updated as any
            });
        }
    }
}

