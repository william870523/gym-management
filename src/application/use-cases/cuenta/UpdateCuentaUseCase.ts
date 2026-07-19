import { randomUUID } from "crypto";
import type { UpdateCuentaDTO } from "../../dtos/CuentaDTO";
import type { Cuenta } from "../../../domain/entities/Cuenta";
import type { CuentaRepository } from "../../../domain/repositories/CuentaRepository";
import type { SyncLogRepository } from "../../../domain/repositories/SyncLogRepository";

export class UpdateCuentaUseCase {
    constructor(
        private readonly cuentaRepository: CuentaRepository,
        private readonly syncLogRepository: SyncLogRepository
    ) { }

    async execute(id: string, dto: UpdateCuentaDTO, gymId: string): Promise<void> {
        const existing = await this.cuentaRepository.findById(id, gymId);
        if (!existing) {
            throw new Error("Cuenta not found");
        }

        const updateData: Partial<Cuenta> = {
            ...dto,
            updated_at: new Date(),
            version: (existing.version ?? 0) + 1
        };

        await this.cuentaRepository.update(id, gymId, updateData);

        const updated = await this.cuentaRepository.findById(id, gymId);
        if (updated) {
            await this.syncLogRepository.register({
                eventId: randomUUID(),
                entidad: "cuenta",
                operacion: "UPDATE",
                entidadId: id,
                gymId: updated.gym_id,
                deviceId: "WEB_ADMIN",
                payload: updated as any
            });
        }
    }
}

